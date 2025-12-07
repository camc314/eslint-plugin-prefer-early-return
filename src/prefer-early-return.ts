import { defineRule, type ESTree } from 'oxlint';

type IfStatement = ESTree.IfStatement;
type Statement = ESTree.Statement;

/**
 * Gets the statements from a block statement or wraps a single statement.
 */
function getBlockStatements(statement: Statement): Statement[] {
    if (statement.type === 'BlockStatement') {
        return statement.body;
    }
    return [statement];
}

/**
 * Checks if a node is a function-like node.
 */
function isFunctionNode(node: ESTree.Node): boolean {
    return (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression' ||
        (node.type as string).includes('Function')
    );
}

/**
 * Checks if the parent block is a function body.
 */
function isDirectlyInFunctionBody(node: IfStatement): boolean {
    const parent = node.parent;

    if (parent.type !== 'BlockStatement') {
        return false;
    }

    const grandParent = parent.parent;

    return (
        isFunctionNode(grandParent) ||
        grandParent.type === 'MethodDefinition'
    );
}

/**
 * Checks if an if statement has the pattern where the consequent contains
 * nested if statements or significant code, while the alternate is a simple
 * return/throw (the "else" branch handles the error case).
 *
 * This detects patterns like:
 *   if (condition) {
 *     // more nested code or ifs
 *   } else {
 *     return/throw error;
 *   }
 *
 * Which should become:
 *   if (!condition) return/throw error;
 *   // more code
 */
function hasNestedIfInConsequent(node: IfStatement): boolean {
    const consequentStatements = getBlockStatements(node.consequent);

    for (const stmt of consequentStatements) {
        if (stmt.type === 'IfStatement') {
            return true;
        }
    }
    return false;
}

/**
 * Checks if a statement is a simple exit (return, throw, or single expression).
 * In the context of if-else chains, even expression statements in else branches
 * indicate an early exit pattern (e.g., res.status(401).send("Unauthorized")).
 */
function isSimpleExit(statement: Statement | null): boolean {
    if (!statement) return false;

    if (
        statement.type === 'ReturnStatement' ||
        statement.type === 'ThrowStatement' ||
        statement.type === 'ExpressionStatement'
    ) {
        return true;
    }

    if (statement.type === 'BlockStatement') {
        const body = statement.body;
        // A block with a single statement is simple
        if (body.length === 1) {
            return isSimpleExit(body[0]);
        }
    }

    return false;
}

/**
 * Checks if the given if statement is the last statement in its block.
 */
function isLastStatementInBlock(node: IfStatement): boolean {
    const parent = node.parent;

    if (
        parent.type !== 'BlockStatement' ||
        !('body' in parent) ||
        !Array.isArray(parent.body)
    ) {
        return false;
    }

    const body = parent.body as Statement[];
    const nodeIndex = body.indexOf(node);

    return nodeIndex === body.length - 1;
}

/**
 * Detects the if-else nesting pattern that should use early returns.
 *
 * Pattern 1: if-else where else is a simple exit and consequent has nested ifs
 *   if (user) {
 *     if (order) { ... } else { error }
 *   } else {
 *     return unauthorized;
 *   }
 *
 * Pattern 2: if with nested if-else chains (no top-level else)
 *   if (user) {
 *     if (order) {
 *       if (valid) { ... } else { error }
 *     } else { error }
 *   }
 */
function shouldReportEarlyReturn(node: IfStatement): boolean {
    // Must be directly in a function body
    if (!isDirectlyInFunctionBody(node)) {
        return false;
    }

    // Must be the last statement in the function body
    if (!isLastStatementInBlock(node)) {
        return false;
    }

    // Pattern 1: Has else branch that's a simple exit, and consequent has nested ifs
    if (node.alternate !== null) {
        if (isSimpleExit(node.alternate) && hasNestedIfInConsequent(node)) {
            return true;
        }
        return false;
    }

    // Pattern 2: No else, but consequent has nested if-else
    // This catches: if (a) { if (b) { ... } else { error } }
    const consequentStatements = getBlockStatements(node.consequent);

    // Look for a nested if statement that has an else with a simple exit
    for (const stmt of consequentStatements) {
        if (stmt.type === 'IfStatement' && stmt.alternate !== null) {
            if (isSimpleExit(stmt.alternate)) {
                return true;
            }
        }
    }

    return false;
}

export const preferEarlyReturnRule = defineRule({
    meta: {
        type: 'suggestion',
        docs: {
            description:
                'Prefer early returns to reduce nesting and improve code readability',
            recommended: false,
        },
        messages: {
            preferEarlyReturn:
                'Prefer early returns to reduce nesting. Invert the condition and return early instead of wrapping code in an if-else.',
        },
        schema: [],
    },
    create(context) {
        return {
            IfStatement(node: ESTree.Node) {
                const ifNode = node as IfStatement;
                if (shouldReportEarlyReturn(ifNode)) {
                    context.report({
                        node,
                        messageId: 'preferEarlyReturn',
                    });
                }
            },
        };
    },
});
