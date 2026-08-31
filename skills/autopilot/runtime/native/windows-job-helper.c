#define UNICODE
#define _UNICODE
#define _WIN32_WINNT 0x0601
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <sddl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#define PROTOCOL_VERSION 1u
#define OPERATION_LAUNCH 1u
#define OPERATION_QUERY 2u
#define OPERATION_TERMINATE 3u
#define MAXIMUM_PROTOCOL_BYTES 16777216u
#define MAXIMUM_FIELD_BYTES 1048576u
#define MAXIMUM_LIST_ENTRIES 16384u
#define TERMINATION_EXIT_CODE 124u
#define BROKER_AUTH_TIMEOUT_MS 1000u

static const unsigned char PROTOCOL_MAGIC[8] = { 'A', 'P', 'J', 'O', 'B', '0', '0', '1' };

typedef struct BufferReader {
  unsigned char *bytes;
  size_t length;
  size_t offset;
} BufferReader;

typedef struct LaunchRequest {
  wchar_t *broker_name;
  wchar_t *broker_token;
  wchar_t *executable;
  wchar_t *cwd;
  wchar_t **arguments;
  uint32_t argument_count;
  wchar_t **environment_names;
  wchar_t **environment_values;
  uint32_t environment_count;
} LaunchRequest;

typedef struct BrokerContext {
  HANDLE job;
  HANDLE pipe;
  const wchar_t *broker_name;
  const wchar_t *broker_token;
  volatile LONG ready;
  volatile LONG stopping;
  volatile LONG control_active;
  volatile LONG readiness_observed;
} BrokerContext;

static void write_error(const char *message, DWORD error) {
  if (error == 0) {
    fprintf(stderr, "%s\n", message);
  } else {
    fprintf(stderr, "%s (win32=%lu)\n", message, (unsigned long)error);
  }
}

static int read_all_handle(HANDLE input, BufferReader *reader) {
  DWORD capacity = 4096;
  DWORD length = 0;
  unsigned char *bytes = (unsigned char *)malloc(capacity);
  if (bytes == NULL) {
    return 0;
  }
  for (;;) {
    DWORD read = 0;
    unsigned char overflow;
    if (length == MAXIMUM_PROTOCOL_BYTES) {
      BOOL success = ReadFile(input, &overflow, 1, &read, NULL);
      if ((success && read == 0) || (!success && GetLastError() == ERROR_BROKEN_PIPE)) {
        break;
      }
      free(bytes);
      return 0;
    }
    if (length == capacity) {
      DWORD next_capacity = capacity > MAXIMUM_PROTOCOL_BYTES / 2 ? MAXIMUM_PROTOCOL_BYTES : capacity * 2;
      unsigned char *next = (unsigned char *)realloc(bytes, next_capacity);
      if (next == NULL) {
        free(bytes);
        return 0;
      }
      bytes = next;
      capacity = next_capacity;
    }
    if (!ReadFile(input, bytes + length, capacity - length, &read, NULL)) {
      if (GetLastError() == ERROR_BROKEN_PIPE) {
        break;
      }
      free(bytes);
      return 0;
    }
    if (read == 0) {
      break;
    }
    length += read;
  }
  reader->bytes = bytes;
  reader->length = length;
  reader->offset = 0;
  return 1;
}

static int read_pipe_message(HANDLE pipe, BufferReader *reader) {
  DWORD length = 0;
  DWORD read = 0;
  ULONGLONG deadline = GetTickCount64() + BROKER_AUTH_TIMEOUT_MS;
  unsigned char *bytes = (unsigned char *)malloc(MAXIMUM_PROTOCOL_BYTES);
  HANDLE event = CreateEventW(NULL, TRUE, FALSE, NULL);
  if (bytes == NULL || event == NULL) {
    free(bytes);
    if (event != NULL) {
      CloseHandle(event);
    }
    return 0;
  }
  for (;;) {
    OVERLAPPED overlapped;
    BOOL success;
    DWORD error;
    DWORD timeout;
    memset(&overlapped, 0, sizeof(overlapped));
    overlapped.hEvent = event;
    ResetEvent(event);
    read = 0;
    success = ReadFile(pipe, bytes + length, MAXIMUM_PROTOCOL_BYTES - length, &read, &overlapped);
    error = success ? ERROR_SUCCESS : GetLastError();
    if (!success && error == ERROR_IO_PENDING) {
      ULONGLONG now = GetTickCount64();
      timeout = now >= deadline ? 0 : (DWORD)(deadline - now);
      if (WaitForSingleObject(event, timeout) != WAIT_OBJECT_0) {
        CancelIoEx(pipe, &overlapped);
        WaitForSingleObject(event, INFINITE);
        SetLastError(ERROR_TIMEOUT);
        free(bytes);
        CloseHandle(event);
        return 0;
      }
      success = GetOverlappedResult(pipe, &overlapped, &read, FALSE);
      error = success ? ERROR_SUCCESS : GetLastError();
    }
    length += read;
    if (success) {
      break;
    }
    if (error != ERROR_MORE_DATA || length == MAXIMUM_PROTOCOL_BYTES) {
      SetLastError(error);
      free(bytes);
      CloseHandle(event);
      return 0;
    }
  }
  CloseHandle(event);
  reader->bytes = bytes;
  reader->length = length;
  reader->offset = 0;
  return 1;
}

static int read_uint32(BufferReader *reader, uint32_t *value) {
  unsigned char *bytes;
  if (reader->offset + 4 > reader->length) {
    return 0;
  }
  bytes = reader->bytes + reader->offset;
  *value = (uint32_t)bytes[0] | ((uint32_t)bytes[1] << 8) | ((uint32_t)bytes[2] << 16) | ((uint32_t)bytes[3] << 24);
  reader->offset += 4;
  return 1;
}

static int utf8_to_wide(const unsigned char *bytes, uint32_t length, wchar_t **value) {
  int wide_length;
  wchar_t *wide;
  if (length > MAXIMUM_FIELD_BYTES || memchr(bytes, 0, length) != NULL) {
    return 0;
  }
  wide_length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (const char *)bytes, (int)length, NULL, 0);
  if (wide_length <= 0 && length != 0) {
    return 0;
  }
  wide = (wchar_t *)calloc((size_t)wide_length + 1, sizeof(wchar_t));
  if (wide == NULL) {
    return 0;
  }
  if (wide_length > 0 && MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (const char *)bytes, (int)length, wide, wide_length) != wide_length) {
    free(wide);
    return 0;
  }
  *value = wide;
  return 1;
}

static int read_string(BufferReader *reader, wchar_t **value) {
  uint32_t length;
  if (!read_uint32(reader, &length) || reader->offset + length > reader->length) {
    return 0;
  }
  if (!utf8_to_wide(reader->bytes + reader->offset, length, value)) {
    return 0;
  }
  reader->offset += length;
  return 1;
}

static int valid_hex_token(const wchar_t *value) {
  size_t index;
  if (wcslen(value) != 64) {
    return 0;
  }
  for (index = 0; index < 64; index += 1) {
    wchar_t character = value[index];
    if (!((character >= L'0' && character <= L'9') || (character >= L'a' && character <= L'f'))) {
      return 0;
    }
  }
  return 1;
}

static int valid_broker_name(const wchar_t *name) {
  static const wchar_t prefix[] = L"\\\\.\\pipe\\AutopilotBroker_";
  size_t prefix_length = wcslen(prefix);
  return wcsncmp(name, prefix, prefix_length) == 0 && valid_hex_token(name + prefix_length);
}

static void free_launch_request(LaunchRequest *request) {
  uint32_t index;
  free(request->broker_name);
  free(request->broker_token);
  free(request->executable);
  free(request->cwd);
  for (index = 0; index < request->argument_count; index += 1) {
    free(request->arguments[index]);
  }
  free(request->arguments);
  for (index = 0; index < request->environment_count; index += 1) {
    free(request->environment_names[index]);
    free(request->environment_values[index]);
  }
  free(request->environment_names);
  free(request->environment_values);
  memset(request, 0, sizeof(*request));
}

static int read_launch_request(BufferReader *reader, LaunchRequest *request) {
  uint32_t index;
  if (!read_string(reader, &request->broker_name) || !read_string(reader, &request->broker_token)
      || !read_string(reader, &request->executable) || !read_string(reader, &request->cwd)
      || !read_uint32(reader, &request->argument_count) || request->argument_count > MAXIMUM_LIST_ENTRIES) {
    return 0;
  }
  request->arguments = (wchar_t **)calloc(request->argument_count, sizeof(wchar_t *));
  if (request->argument_count > 0 && request->arguments == NULL) {
    return 0;
  }
  for (index = 0; index < request->argument_count; index += 1) {
    if (!read_string(reader, &request->arguments[index])) {
      return 0;
    }
  }
  if (!read_uint32(reader, &request->environment_count) || request->environment_count > MAXIMUM_LIST_ENTRIES) {
    return 0;
  }
  request->environment_names = (wchar_t **)calloc(request->environment_count, sizeof(wchar_t *));
  request->environment_values = (wchar_t **)calloc(request->environment_count, sizeof(wchar_t *));
  if (request->environment_count > 0 && (request->environment_names == NULL || request->environment_values == NULL)) {
    return 0;
  }
  for (index = 0; index < request->environment_count; index += 1) {
    if (!read_string(reader, &request->environment_names[index]) || !read_string(reader, &request->environment_values[index])
        || wcschr(request->environment_names[index], L'=') != NULL || request->environment_names[index][0] == L'\0') {
      return 0;
    }
  }
  return reader->offset == reader->length && valid_broker_name(request->broker_name)
      && valid_hex_token(request->broker_token) && request->executable[0] != L'\0' && request->cwd[0] != L'\0';
}

static int read_control_request(BufferReader *reader, uint32_t *operation, wchar_t **broker_name, wchar_t **broker_token) {
  uint32_t version;
  if (reader->length < sizeof(PROTOCOL_MAGIC) + 8 || memcmp(reader->bytes, PROTOCOL_MAGIC, sizeof(PROTOCOL_MAGIC)) != 0) {
    return 0;
  }
  reader->offset = sizeof(PROTOCOL_MAGIC);
  if (!read_uint32(reader, &version) || version != PROTOCOL_VERSION || !read_uint32(reader, operation)
      || (*operation != OPERATION_QUERY && *operation != OPERATION_TERMINATE)
      || !read_string(reader, broker_name) || !read_string(reader, broker_token) || reader->offset != reader->length) {
    return 0;
  }
  return valid_broker_name(*broker_name) && valid_hex_token(*broker_token);
}

static size_t quoted_argument_length(const wchar_t *argument) {
  size_t length = 2;
  size_t slashes = 0;
  const wchar_t *cursor;
  for (cursor = argument; *cursor != L'\0'; cursor += 1) {
    if (*cursor == L'\\') {
      slashes += 1;
    } else if (*cursor == L'"') {
      length += slashes * 2 + 2;
      slashes = 0;
    } else {
      length += slashes + 1;
      slashes = 0;
    }
  }
  return length + slashes * 2;
}

static wchar_t *append_quoted_argument(wchar_t *output, const wchar_t *argument) {
  size_t slashes = 0;
  const wchar_t *cursor;
  *output++ = L'"';
  for (cursor = argument; *cursor != L'\0'; cursor += 1) {
    if (*cursor == L'\\') {
      slashes += 1;
      continue;
    }
    if (*cursor == L'"') {
      while (slashes > 0) {
        *output++ = L'\\';
        *output++ = L'\\';
        slashes -= 1;
      }
      *output++ = L'\\';
      *output++ = L'"';
    } else {
      while (slashes > 0) {
        *output++ = L'\\';
        slashes -= 1;
      }
      *output++ = *cursor;
    }
    slashes = 0;
  }
  while (slashes > 0) {
    *output++ = L'\\';
    *output++ = L'\\';
    slashes -= 1;
  }
  *output++ = L'"';
  return output;
}

static wchar_t *build_command_line(const LaunchRequest *request) {
  size_t length = quoted_argument_length(request->executable) + 1;
  uint32_t index;
  wchar_t *command_line;
  wchar_t *cursor;
  for (index = 0; index < request->argument_count; index += 1) {
    length += quoted_argument_length(request->arguments[index]) + 1;
  }
  command_line = (wchar_t *)calloc(length, sizeof(wchar_t));
  if (command_line == NULL) {
    return NULL;
  }
  cursor = append_quoted_argument(command_line, request->executable);
  for (index = 0; index < request->argument_count; index += 1) {
    *cursor++ = L' ';
    cursor = append_quoted_argument(cursor, request->arguments[index]);
  }
  *cursor = L'\0';
  return command_line;
}

static wchar_t *build_environment(const LaunchRequest *request) {
  size_t length = 2;
  uint32_t index;
  wchar_t *block;
  wchar_t *cursor;
  for (index = 0; index < request->environment_count; index += 1) {
    length += wcslen(request->environment_names[index]) + wcslen(request->environment_values[index]) + 2;
  }
  block = (wchar_t *)calloc(length, sizeof(wchar_t));
  if (block == NULL) {
    return NULL;
  }
  cursor = block;
  for (index = 0; index < request->environment_count; index += 1) {
    size_t remaining = length - (size_t)(cursor - block);
    wcscpy_s(cursor, remaining, request->environment_names[index]);
    cursor += wcslen(cursor);
    *cursor++ = L'=';
    wcscpy_s(cursor, length - (size_t)(cursor - block), request->environment_values[index]);
    cursor += wcslen(cursor) + 1;
  }
  *cursor = L'\0';
  return block;
}

static int deny_job_handle_duplication(void) {
  PSECURITY_DESCRIPTOR descriptor = NULL;
  static const wchar_t policy[] = L"D:P(D;;0x0040;;;WD)(A;;0x00101001;;;OW)(A;;GA;;;SY)(A;;GA;;;BA)";
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(policy, SDDL_REVISION_1, &descriptor, NULL)) {
    return 0;
  }
  if (!SetKernelObjectSecurity(GetCurrentProcess(), DACL_SECURITY_INFORMATION, descriptor)) {
    DWORD error = GetLastError();
    LocalFree(descriptor);
    SetLastError(error);
    return 0;
  }
  LocalFree(descriptor);
  return 1;
}

static int query_active_processes(HANDLE job, DWORD *active_processes) {
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION information;
  if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &information, sizeof(information), NULL)) {
    return 0;
  }
  *active_processes = information.ActiveProcesses;
  return 1;
}

static int format_observation(char *output, size_t output_length, const char *state, DWORD active_processes) {
  int written = sprintf_s(output, output_length,
      "{\"schemaVersion\":1,\"protocolVersion\":1,\"state\":\"%s\",\"activeProcesses\":%lu}\n",
      state, (unsigned long)active_processes);
  return written > 0 ? written : 0;
}

static int connect_broker_pipe(HANDLE pipe) {
  OVERLAPPED overlapped;
  HANDLE event = CreateEventW(NULL, TRUE, FALSE, NULL);
  BOOL connected;
  DWORD error;
  DWORD transferred = 0;
  if (event == NULL) {
    return 0;
  }
  memset(&overlapped, 0, sizeof(overlapped));
  overlapped.hEvent = event;
  connected = ConnectNamedPipe(pipe, &overlapped);
  error = connected ? ERROR_SUCCESS : GetLastError();
  if (!connected && error == ERROR_IO_PENDING) {
    if (WaitForSingleObject(event, INFINITE) == WAIT_OBJECT_0) {
      connected = GetOverlappedResult(pipe, &overlapped, &transferred, FALSE);
    }
  } else if (!connected && error == ERROR_PIPE_CONNECTED) {
    connected = TRUE;
  }
  CloseHandle(event);
  return connected ? 1 : 0;
}

static int write_pipe_message(HANDLE pipe, const char *response, DWORD response_length) {
  OVERLAPPED overlapped;
  HANDLE event = CreateEventW(NULL, TRUE, FALSE, NULL);
  DWORD written = 0;
  BOOL success;
  if (event == NULL) {
    return 0;
  }
  memset(&overlapped, 0, sizeof(overlapped));
  overlapped.hEvent = event;
  success = WriteFile(pipe, response, response_length, &written, &overlapped);
  if (!success && GetLastError() == ERROR_IO_PENDING) {
    if (WaitForSingleObject(event, BROKER_AUTH_TIMEOUT_MS) == WAIT_OBJECT_0) {
      success = GetOverlappedResult(pipe, &overlapped, &written, FALSE);
    } else {
      CancelIoEx(pipe, &overlapped);
      WaitForSingleObject(event, INFINITE);
      success = FALSE;
    }
  }
  CloseHandle(event);
  return success && written == response_length;
}

static DWORD WINAPI broker_thread(void *parameter) {
  BrokerContext *context = (BrokerContext *)parameter;
  while (InterlockedCompareExchange(&context->stopping, 0, 0) == 0) {
    BOOL connected = connect_broker_pipe(context->pipe);
    if (connected) {
      BufferReader request;
      wchar_t *broker_name = NULL;
      wchar_t *broker_token = NULL;
      uint32_t operation = 0;
      char response[256];
      int response_length = 0;
      int response_marks_ready = 0;
      InterlockedExchange(&context->control_active, 1);
      memset(&request, 0, sizeof(request));
      if (read_pipe_message(context->pipe, &request)
          && read_control_request(&request, &operation, &broker_name, &broker_token)
          && wcscmp(broker_name, context->broker_name) == 0
          && wcscmp(broker_token, context->broker_token) == 0) {
        DWORD active_processes = 0;
        if (operation == OPERATION_TERMINATE) {
          if (TerminateJobObject(context->job, TERMINATION_EXIT_CODE)) {
            ULONGLONG deadline = GetTickCount64() + 5000;
            do {
              if (!query_active_processes(context->job, &active_processes)) {
                active_processes = 1;
                break;
              }
              if (active_processes != 0) {
                Sleep(25);
              }
            } while (active_processes != 0 && GetTickCount64() < deadline);
            if (active_processes == 0) {
              response_length = format_observation(response, sizeof(response), "terminated", 0);
            }
          }
        } else if (query_active_processes(context->job, &active_processes)) {
          const char *state = InterlockedCompareExchange(&context->ready, 0, 0) == 0
              ? "starting"
              : active_processes == 0 ? "empty" : "ready";
          response_marks_ready = state[0] == 'r';
          response_length = format_observation(response, sizeof(response), state, active_processes);
        }
      }
      if (response_length > 0
          && write_pipe_message(context->pipe, response, (DWORD)response_length)
          && response_marks_ready) {
        InterlockedExchange(&context->readiness_observed, 1);
      }
      free(request.bytes);
      free(broker_name);
      free(broker_token);
    }
    DisconnectNamedPipe(context->pipe);
    InterlockedExchange(&context->control_active, 0);
  }
  return 0;
}

static int control_broker(BufferReader *request, const wchar_t *broker_name) {
  HANDLE pipe;
  DWORD mode = PIPE_READMODE_MESSAGE;
  DWORD written = 0;
  char response[1024];
  DWORD response_length = 0;
  if (!WaitNamedPipeW(broker_name, 100)) {
    DWORD error = GetLastError();
    const char *state = error == ERROR_FILE_NOT_FOUND ? "absent" : error == ERROR_SEM_TIMEOUT ? "busy" : NULL;
    if (state != NULL) {
      int observation_length = format_observation(response, sizeof(response), state, 0);
      return observation_length > 0
          && fwrite(response, 1, (size_t)observation_length, stdout) == (size_t)observation_length ? 0 : 1;
    }
    write_error("Windows Job Object broker is unavailable", error);
    return 1;
  }
  pipe = CreateFileW(broker_name, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
  if (pipe == INVALID_HANDLE_VALUE) {
    DWORD error = GetLastError();
    const char *state = error == ERROR_FILE_NOT_FOUND ? "absent" : error == ERROR_PIPE_BUSY ? "busy" : NULL;
    if (state != NULL) {
      int observation_length = format_observation(response, sizeof(response), state, 0);
      return observation_length > 0
          && fwrite(response, 1, (size_t)observation_length, stdout) == (size_t)observation_length ? 0 : 1;
    }
    write_error("cannot connect to the Windows Job Object broker", error);
    return 1;
  }
  if (!SetNamedPipeHandleState(pipe, &mode, NULL, NULL)
      || !WriteFile(pipe, request->bytes, (DWORD)request->length, &written, NULL)
      || written != request->length
      || !ReadFile(pipe, response, sizeof(response), &response_length, NULL)
      || response_length == 0) {
    write_error("Windows Job Object broker control failed", GetLastError());
    CloseHandle(pipe);
    return 1;
  }
  CloseHandle(pipe);
  if (fwrite(response, 1, response_length, stdout) != response_length) {
    write_error("cannot publish Windows Job Object broker response", 0);
    return 1;
  }
  return 0;
}

static int launch_broker(const LaunchRequest *request) {
  HANDLE job = NULL;
  HANDLE pipe = INVALID_HANDLE_VALUE;
  HANDLE broker_thread_handle = NULL;
  wchar_t *command_line = NULL;
  wchar_t *environment = NULL;
  PROCESS_INFORMATION process_information;
  STARTUPINFOW startup_information;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
  BrokerContext context;
  DWORD root_exit_code = 1;
  DWORD active_processes = 0;
  ULONGLONG quiescence_deadline;
  int result = 1;
  memset(&process_information, 0, sizeof(process_information));
  memset(&startup_information, 0, sizeof(startup_information));
  memset(&limits, 0, sizeof(limits));
  memset(&context, 0, sizeof(context));
  startup_information.cb = sizeof(startup_information);
  startup_information.dwFlags = STARTF_USESTDHANDLES;
  startup_information.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  startup_information.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  startup_information.hStdError = GetStdHandle(STD_ERROR_HANDLE);

  if (!deny_job_handle_duplication()) {
    write_error("cannot deny Job Object handle duplication from the broker", GetLastError());
    goto cleanup;
  }
  job = CreateJobObjectW(NULL, NULL);
  if (job == NULL) {
    write_error("cannot create the private Job Object", GetLastError());
    goto cleanup;
  }
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
    write_error("cannot configure private Job Object kill-on-close", GetLastError());
    goto cleanup;
  }
  pipe = CreateNamedPipeW(request->broker_name,
      PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED,
      PIPE_TYPE_MESSAGE | PIPE_READMODE_MESSAGE | PIPE_WAIT,
      1, 4096, 4096, 5000, NULL);
  if (pipe == INVALID_HANDLE_VALUE) {
    write_error("cannot create the unique Windows Job Object broker channel", GetLastError());
    goto cleanup;
  }
  context.job = job;
  context.pipe = pipe;
  context.broker_name = request->broker_name;
  context.broker_token = request->broker_token;
  broker_thread_handle = CreateThread(NULL, 0, broker_thread, &context, 0, NULL);
  if (broker_thread_handle == NULL) {
    write_error("cannot start the Windows Job Object broker", GetLastError());
    goto cleanup;
  }
  command_line = build_command_line(request);
  environment = build_environment(request);
  if (command_line == NULL || environment == NULL) {
    write_error("cannot allocate the contained child launch request", 0);
    goto cleanup;
  }
  if (!CreateProcessW(request->executable, command_line, NULL, NULL, TRUE,
      CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
      environment, request->cwd, &startup_information, &process_information)) {
    write_error("cannot create the harness process suspended", GetLastError());
    goto cleanup;
  }
  if (!AssignProcessToJobObject(job, process_information.hProcess)) {
    write_error("cannot assign the suspended harness process to the private Job Object", GetLastError());
    TerminateProcess(process_information.hProcess, TERMINATION_EXIT_CODE);
    goto cleanup;
  }
  InterlockedExchange(&context.ready, 1);
  {
    ULONGLONG readiness_deadline = GetTickCount64() + 5000;
    while (InterlockedCompareExchange(&context.readiness_observed, 0, 0) == 0 && GetTickCount64() < readiness_deadline) {
      Sleep(10);
    }
  }
  if (InterlockedCompareExchange(&context.readiness_observed, 0, 0) == 0) {
    write_error("broker readiness was not observed before the launch deadline", 0);
    TerminateJobObject(job, TERMINATION_EXIT_CODE);
    goto cleanup;
  }
  if (ResumeThread(process_information.hThread) == (DWORD)-1) {
    write_error("cannot resume the contained harness process", GetLastError());
    TerminateJobObject(job, TERMINATION_EXIT_CODE);
    goto cleanup;
  }
  WaitForSingleObject(process_information.hProcess, INFINITE);
  if (!GetExitCodeProcess(process_information.hProcess, &root_exit_code)) {
    root_exit_code = 1;
  }
  if (!query_active_processes(job, &active_processes)) {
    write_error("cannot query private Job Object completion", GetLastError());
    goto cleanup;
  }
  if (active_processes != 0 && !TerminateJobObject(job, TERMINATION_EXIT_CODE)) {
    write_error("cannot quiesce descendants after harness completion", GetLastError());
    goto cleanup;
  }
  quiescence_deadline = GetTickCount64() + 5000;
  do {
    if (!query_active_processes(job, &active_processes)) {
      write_error("cannot prove private Job Object process quiescence", GetLastError());
      goto cleanup;
    }
    if (active_processes != 0) {
      if (GetTickCount64() >= quiescence_deadline) {
        write_error("private Job Object descendants did not quiesce within five seconds", 0);
        goto cleanup;
      }
      Sleep(25);
    }
  } while (active_processes != 0);
  result = (int)root_exit_code;

cleanup:
  if (broker_thread_handle != NULL && InterlockedCompareExchange(&context.control_active, 0, 0) != 0) {
    ULONGLONG control_deadline = GetTickCount64() + 6000;
    while (InterlockedCompareExchange(&context.control_active, 0, 0) != 0 && GetTickCount64() < control_deadline) {
      Sleep(10);
    }
  }
  InterlockedExchange(&context.stopping, 1);
  if (pipe != INVALID_HANDLE_VALUE) {
    CancelIoEx(pipe, NULL);
  }
  if (broker_thread_handle != NULL) {
    CancelSynchronousIo(broker_thread_handle);
    WaitForSingleObject(broker_thread_handle, 1000);
    CloseHandle(broker_thread_handle);
  }
  if (process_information.hThread != NULL) {
    CloseHandle(process_information.hThread);
  }
  if (process_information.hProcess != NULL) {
    CloseHandle(process_information.hProcess);
  }
  if (pipe != INVALID_HANDLE_VALUE) {
    CloseHandle(pipe);
  }
  if (job != NULL) {
    CloseHandle(job);
  }
  free(command_line);
  free(environment);
  return result;
}

int wmain(void) {
  BufferReader reader;
  uint32_t version;
  uint32_t operation;
  wchar_t *broker_name = NULL;
  wchar_t *broker_token = NULL;
  LaunchRequest launch_request;
  int result = 1;
  memset(&reader, 0, sizeof(reader));
  memset(&launch_request, 0, sizeof(launch_request));
  if (!read_all_handle(GetStdHandle(STD_INPUT_HANDLE), &reader)
      || reader.length < sizeof(PROTOCOL_MAGIC) + 8
      || memcmp(reader.bytes, PROTOCOL_MAGIC, sizeof(PROTOCOL_MAGIC)) != 0) {
    write_error("malformed Windows Job Object broker protocol", 0);
    goto cleanup;
  }
  reader.offset = sizeof(PROTOCOL_MAGIC);
  if (!read_uint32(&reader, &version) || version != PROTOCOL_VERSION || !read_uint32(&reader, &operation)) {
    write_error("unsupported Windows Job Object broker protocol", 0);
    goto cleanup;
  }
  if (operation == OPERATION_LAUNCH) {
    if (!read_launch_request(&reader, &launch_request)) {
      write_error("malformed Windows Job Object broker launch request", 0);
      goto cleanup;
    }
    result = launch_broker(&launch_request);
  } else if (operation == OPERATION_QUERY || operation == OPERATION_TERMINATE) {
    reader.offset = 0;
    if (!read_control_request(&reader, &operation, &broker_name, &broker_token)) {
      write_error("malformed Windows Job Object broker control request", 0);
      goto cleanup;
    }
    result = control_broker(&reader, broker_name);
  } else {
    write_error("unsupported Windows Job Object broker operation", 0);
  }

cleanup:
  free(broker_name);
  free(broker_token);
  free_launch_request(&launch_request);
  free(reader.bytes);
  return result;
}
