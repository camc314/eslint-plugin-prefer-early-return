import { describe, it } from 'vitest';
import { RuleTester } from 'oxlint';
import { preferEarlyReturnRule } from './prefer-early-return';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester();

ruleTester.run('prefer-early-return', preferEarlyReturnRule, {
    valid: [
        // Simple function with no if statement
        'function foo() { return 1; }',

        // Simple if-else without nesting (both branches do real work)
        `function foo() {
            if (condition) {
                doSomething();
            } else {
                doOther();
            }
        }`,

        // If without else - no early return pattern
        `function foo() {
            if (condition) {
                doSomething();
            }
        }`,

        // If-else where else is not a simple exit
        `function foo() {
            if (condition) {
                if (nested) {
                    doA();
                }
            } else {
                doSomething();
                doMore();
            }
        }`,

        // If statement not at end of function
        `function foo() {
            if (condition) {
                if (nested) {
                    doA();
                } else {
                    return;
                }
            }
            doAfter();
        }`,

        // If statement outside of function body (global scope)
        `if (condition) {
            if (nested) {
                doA();
            } else {
                throw new Error();
            }
        }`,

        // Arrow function with expression body (no block)
        'const foo = () => condition ? doSomething() : null;',

        // If statement in a loop - not directly in function body
        `function foo() {
            for (let i = 0; i < 10; i++) {
                if (condition) {
                    if (nested) {
                        doA();
                    } else {
                        return;
                    }
                }
            }
        }`,

        // Already using early return pattern
        `function foo() {
            if (!user) return unauthorized();
            if (!order) return notFound();
            return order;
        }`,

        // Simple guard clause (not nested)
        `function foo() {
            if (!condition) {
                return;
            }
            doWork();
        }`,

        // Nested if without else branches
        `function foo() {
            if (a) {
                if (b) {
                    doSomething();
                }
            }
        }`,

        // else-if chain (not the pattern we're looking for)
        `function foo() {
            if (a) {
                doA();
            } else if (b) {
                doB();
            } else {
                doC();
            }
        }`,
    ],

    invalid: [
        // Classic deeply nested if-else pattern (the main use case)
        {
            code: `async function handleOrder(req, res) {
                if (req.user) {
                    if (req.body.orderId) {
                        const order = await getOrder(req.body.orderId);
                        if (order) {
                            if (order.userId === req.user.id) {
                                res.json(order);
                            } else {
                                res.status(403).send("Forbidden");
                            }
                        } else {
                            res.status(404).send("Order not found");
                        }
                    } else {
                        res.status(400).send("Missing orderId");
                    }
                } else {
                    res.status(401).send("Unauthorized");
                }
            }`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // Simple case: if with nested if-else, outer else is simple return
        {
            code: `function foo() {
                if (user) {
                    if (isValid) {
                        doWork();
                    } else {
                        return error();
                    }
                } else {
                    return unauthorized();
                }
            }`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // If-else where else is a simple return, consequent has nested if
        {
            code: `function foo() {
                if (condition) {
                    if (nested) {
                        doSomething();
                    }
                } else {
                    return;
                }
            }`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // If-else where else is a simple throw
        {
            code: `function foo() {
                if (condition) {
                    if (nested) {
                        doSomething();
                    }
                } else {
                    throw new Error("Invalid");
                }
            }`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // If without else, but nested if has else with return
        {
            code: `function foo() {
                if (condition) {
                    if (nested) {
                        doSomething();
                    } else {
                        return error();
                    }
                }
            }`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // Arrow function with nested if-else
        {
            code: `const foo = () => {
                if (user) {
                    if (valid) {
                        return data;
                    } else {
                        return null;
                    }
                } else {
                    return unauthorized;
                }
            };`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // Function expression
        {
            code: `const foo = function() {
                if (a) {
                    if (b) {
                        work();
                    } else {
                        return;
                    }
                } else {
                    return;
                }
            };`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // Class method
        {
            code: `class Foo {
                bar() {
                    if (this.ready) {
                        if (this.valid) {
                            this.process();
                        } else {
                            return false;
                        }
                    } else {
                        return false;
                    }
                }
            }`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // Async function with nested awaits
        {
            code: `async function fetchData() {
                if (token) {
                    if (await validate(token)) {
                        return await getData();
                    } else {
                        return null;
                    }
                } else {
                    return null;
                }
            }`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // Object method
        {
            code: `const obj = {
                process() {
                    if (this.enabled) {
                        if (this.data) {
                            return this.transform();
                        } else {
                            return [];
                        }
                    } else {
                        return [];
                    }
                }
            };`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // Three levels of nesting
        {
            code: `function validate(req) {
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
            }`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // With block statement in else
        {
            code: `function foo() {
                if (condition) {
                    if (nested) {
                        doWork();
                    }
                } else {
                    { return error(); }
                }
            }`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // Static class method
        {
            code: `class Service {
                static handle(req) {
                    if (req.auth) {
                        if (req.data) {
                            return process(req.data);
                        } else {
                            return { error: 'No data' };
                        }
                    } else {
                        return { error: 'Unauthorized' };
                    }
                }
            }`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // Getter with nested if
        {
            code: `const obj = {
                get value() {
                    if (this._cache) {
                        if (this._valid) {
                            return this._cache;
                        } else {
                            return null;
                        }
                    } else {
                        return null;
                    }
                }
            };`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // IIFE
        {
            code: `(function() {
                if (ready) {
                    if (valid) {
                        run();
                    } else {
                        return;
                    }
                } else {
                    return;
                }
            })();`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },

        // Multiple nested ifs in consequent
        {
            code: `function foo() {
                if (a) {
                    if (b) {
                        doB();
                    }
                    if (c) {
                        doC();
                    } else {
                        return;
                    }
                } else {
                    return;
                }
            }`,
            errors: [{ messageId: 'preferEarlyReturn' }],
        },
    ],
});
