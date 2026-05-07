# Functional Interface Composition

Prefer the built-in composition methods on `Function`, `Consumer`, and `Predicate` over lambdas that only forward inputs through existing functional values. They communicate intent more directly and make stream pipelines easier to read.

Use:

- `Function.andThen(Function)` / `Function.compose(Function)`
- `Consumer.andThen(Consumer)`
- `Predicate.and(Predicate)` / `Predicate.or(Predicate)`
- `Predicate.negate()` / `Predicate.not(Predicate)`

## Examples

**`Function.andThen` — chain a transformation onto an existing function:**

```java
// ✅ Preferred
Function<User, String> displayName =
    userToProfile.andThen(Profile::displayName);

// ❌ Avoid
Function<User, String> displayName =
    user -> userToProfile.apply(user).displayName();
```

**`Function.andThen` — chain two `Function` values:**

```java
// ✅ Preferred
Function<String, Integer> parseAndClamp =
    parseInteger.andThen(clampToRange);

// ❌ Avoid
Function<String, Integer> parseAndClamp =
    value -> clampToRange.apply(parseInteger.apply(value));
```

**`Consumer.andThen` — sequence side effects:**

```java
// ✅ Preferred
Consumer<Order> processOrder =
    validateOrder.andThen(saveOrder).andThen(sendConfirmation);

// ❌ Avoid
Consumer<Order> processOrder = order -> {
    validateOrder.accept(order);
    saveOrder.accept(order);
    sendConfirmation.accept(order);
};
```

**`Predicate.and` / `Predicate.or` — combine conditions:**

```java
// ✅ Preferred
Predicate<User> activeAdult = isActive.and(isAdult);
Predicate<User> eligible    = isAdmin.or(isOwner);

// ❌ Avoid
Predicate<User> activeAdult = user -> isActive.test(user) && isAdult.test(user);
Predicate<User> eligible    = user -> isAdmin.test(user) || isOwner.test(user);
```

**`Predicate.not(...)` — negate a method reference (always static-import `not`):**

```java
import static java.util.function.Predicate.not;

// ✅ Preferred
Predicate<User> notDeleted = not(User::isDeleted);

// ❌ Avoid — qualified call
Predicate<User> notDeleted = Predicate.not(User::isDeleted);

// ❌ Avoid — inline negation
Predicate<User> notDeleted = user -> !user.isDeleted();
```

**`Predicate.negate()` — negate an existing `Predicate` value:**

```java
// ✅ Preferred
Predicate<User> notInactive = isInactive.negate();

// ❌ Avoid
Predicate<User> notInactive = user -> !isInactive.test(user);
```

## In stream pipelines

```java
// ✅ Preferred
users.stream()
    .filter(isActive.and(isAdult))
    .map(userToProfile.andThen(Profile::displayName))
    .toList();

// ❌ Avoid
users.stream()
    .filter(user -> isActive.test(user) && isAdult.test(user))
    .map(user -> userToProfile.apply(user).displayName())
    .toList();
```

```java
import static java.util.function.Predicate.not;

// ✅ Preferred
users.stream()
    .filter(not(User::isDeleted))
    .toList();

// ❌ Avoid
users.stream()
    .filter(user -> !user.isDeleted())
    .toList();
```

## When to keep the lambda

Composition is a tool, not a goal. Keep a lambda block when **any** of the following apply:

- intermediate values benefit from meaningful names
- exception handling is required
- logging, metrics, or debugging statements are needed
- branching logic is non-trivial
- the lambda does more than chain calls to existing functions/consumers/predicates
- the composed expression becomes too long or hard to read

```java
// ✅ Acceptable lambda — does real work, not just forwarding
Consumer<Order> processOrder = order -> {
    var result = validator.validate(order);
    if (!result.isValid()) {
        log.warn("Invalid order {}: {}", order.id(), result.message());
        return;
    }
    repository.save(order);
    eventPublisher.publish(new OrderAccepted(order.id()));
};
```

## Caveats

- Composition methods on `Function`, `Consumer`, and `Predicate` throw `NullPointerException` if the argument is `null`. Do not switch to composition where the existing code deliberately tolerates `null` operands.
- `Predicate.not(Predicate)` requires Java 11+. This project targets Java 21+, so it is always available — but if you back-port to an older module, fall back to `predicate.negate()` or `value -> !somePredicate.test(value)`.

**General rule** — if a lambda only forwards its input into existing `Function`, `Consumer`, or `Predicate` instances, replace it with the corresponding composition method.
