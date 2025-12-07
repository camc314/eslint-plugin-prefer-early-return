# eslint-plugin-prefer-early-return

An Oxlint rule that enforces early returns to reduce nesting and improve code readability.

## The Problem

Deeply nested if-else chains are hard to read and maintain:

```javascript
async function handleOrder(req, res) {
    if (req.user) {
        if (req.body.orderId) {
            const order = await getOrder(req.body.orderId);
            if (order) {
                if (order.userId === req.user.id) {
                    res.json(order);
                } else {
                    res.status(403).send('Forbidden');
                }
            } else {
                res.status(404).send('Order not found');
            }
        } else {
            res.status(400).send('Missing orderId');
        }
    } else {
        res.status(401).send('Unauthorized');
    }
}
```

## The Solution

Using early returns flattens the code and makes it easier to follow:

```javascript
async function handleOrder(req, res) {
    if (!req.user) return res.status(401).send('Unauthorized');
    if (!req.body.orderId) return res.status(400).send('Missing orderId');

    const order = await getOrder(req.body.orderId);
    if (!order) return res.status(404).send('Order not found');
    if (order.userId !== req.user.id) return res.status(403).send('Forbidden');

    res.json(order);
}
```

## Installation

```bash
npm install eslint-plugin-prefer-early-return
```

## Configuration

### Oxlint

Add the plugin to your `.oxlintrc.json`:

```json
{
    "jsPlugins": ["eslint-plugin-prefer-early-return"],
    "rules": {
        "eslint-plugin-prefer-early-return/prefer-early-return": "error"
    }
}
```

## Rule Details

This rule detects if-else chains where:

1. The `else` branch contains a simple exit (return, throw, or expression statement)
2. The `if` branch contains nested if statements that could be flattened

### Examples of **incorrect** code:

```javascript
function foo() {
    if (user) {
        if (isValid) {
            doWork();
        } else {
            return error();
        }
    } else {
        return unauthorized();
    }
}
```

```javascript
function validate(req) {
    if (req.user) {
        if (req.body) {
            if (req.body.id) {
                return true;
            } else {
                return false;
            }
        } else {
            return false;
        }
    } else {
        return false;
    }
}
```

### Examples of **correct** code:

```javascript
function foo() {
    if (!user) return unauthorized();
    if (!isValid) return error();
    doWork();
}
```

```javascript
function validate(req) {
    if (!req.user) return false;
    if (!req.body) return false;
    if (!req.body.id) return false;
    return true;
}
```

## Autofix

This rule provides an automatic fix that:

-   Inverts conditions (`a` → `!a`, `===` → `!==`, `<` → `>=`, etc.)
-   Converts else branches to early returns
-   Flattens nested if-else chains
-   Preserves throw statements
-   Converts expression statements to return statements when needed
