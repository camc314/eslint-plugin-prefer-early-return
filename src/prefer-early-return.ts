import { defineRule, type ESTree, type SourceCode, type Fixer, type Fix } from 'oxlint';

type IfStatement = ESTree.IfStatement;
type Statement = ESTree.Statement;
type Expression = ESTree.Expression;

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

/**
 * Gets the simple exit statement from a block or statement.
 */
function getSimpleExitStatement(statement: Statement): Statement {
    if (statement.type === 'BlockStatement' && statement.body.length === 1) {
        return getSimpleExitStatement(statement.body[0]);
    }
    return statement;
}

/**
 * Inverts a condition expression and returns the string representation.
 * Handles common cases like:
 * - `a` -> `!a`
 * - `!a` -> `a`
 * - `a === b` -> `a !== b`
 * - `a !== b` -> `a === b`
 * - `a == b` -> `a != b`
 * - `a != b` -> `a == b`
 */
function invertCondition(condition: Expression, sourceCode: SourceCode): string {
    const conditionText = sourceCode.getText(condition);

    // Handle UnaryExpression with ! operator
    if (condition.type === 'UnaryExpression' && condition.operator === '!') {
        // !a -> a (but need parens if it's a complex expression)
        const argument = condition.argument;
        if (
            argument.type === 'Identifier' ||
            argument.type === 'MemberExpression' ||
            argument.type === 'CallExpression'
        ) {
            return sourceCode.getText(argument);
        }
        // For complex expressions, wrap in parens
        return `(${sourceCode.getText(argument)})`;
    }

    // Handle BinaryExpression with equality operators
    if (condition.type === 'BinaryExpression') {
        const left = sourceCode.getText(condition.left);
        const right = sourceCode.getText(condition.right);

        switch (condition.operator) {
            case '===':
                return `${left} !== ${right}`;
            case '!==':
                return `${left} === ${right}`;
            case '==':
                return `${left} != ${right}`;
            case '!=':
                return `${left} == ${right}`;
            case '<':
                return `${left} >= ${right}`;
            case '<=':
                return `${left} > ${right}`;
            case '>':
                return `${left} <= ${right}`;
            case '>=':
                return `${left} < ${right}`;
        }
    }

    // Default: wrap in !()
    // For simple identifiers and member expressions, just use !
    if (
        condition.type === 'Identifier' ||
        condition.type === 'MemberExpression' ||
        condition.type === 'CallExpression'
    ) {
        return `!${conditionText}`;
    }

    return `!(${conditionText})`;
}

/**
 * Converts an exit statement to a return statement if needed.
 * - ReturnStatement stays as is
 * - ThrowStatement stays as is
 * - ExpressionStatement becomes `return <expression>;`
 */
function convertToEarlyReturn(statement: Statement, sourceCode: SourceCode): string {
    const exitStmt = getSimpleExitStatement(statement);

    if (exitStmt.type === 'ReturnStatement' || exitStmt.type === 'ThrowStatement') {
        return sourceCode.getText(exitStmt);
    }

    if (exitStmt.type === 'ExpressionStatement') {
        const exprText = sourceCode.getText(exitStmt.expression);
        return `return ${exprText};`;
    }

    return sourceCode.getText(exitStmt);
}

/**
 * Gets the indentation of a node based on its position.
 */
function getIndentation(node: ESTree.Node, sourceCode: SourceCode): string {
    const text = sourceCode.getText();
    const start = node.start;

    // Find the start of the line
    let lineStart = start;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') {
        lineStart--;
    }

    // Extract the whitespace at the start of the line
    let indent = '';
    for (let i = lineStart; i < start; i++) {
        if (text[i] === ' ' || text[i] === '\t') {
            indent += text[i];
        } else {
            break;
        }
    }

    return indent;
}

/**
 * Recursively flattens nested if-else chains into early returns.
 */
function flattenIfElseChain(
    node: IfStatement,
    sourceCode: SourceCode,
    baseIndent: string
): string {
    const parts: string[] = [];

    let current: IfStatement | null = node;

    while (current) {
        if (current.alternate && isSimpleExit(current.alternate)) {
            // Convert: if (cond) { ... } else { return error; }
            // To: if (!cond) return error;
            const invertedCond = invertCondition(current.test, sourceCode);
            const earlyReturn = convertToEarlyReturn(current.alternate, sourceCode);
            parts.push(`${baseIndent}if (${invertedCond}) ${earlyReturn}`);

            // Now process the consequent
            const consequentStmts = getBlockStatements(current.consequent);

            for (const stmt of consequentStmts) {
                if (stmt.type === 'IfStatement' && stmt.alternate && isSimpleExit(stmt.alternate)) {
                    // Recursively flatten nested if-else
                    parts.push(flattenIfElseChain(stmt, sourceCode, baseIndent));
                } else if (stmt.type === 'IfStatement' && !stmt.alternate) {
                    // if without else - check if it has nested if-else inside
                    const nestedStmts = getBlockStatements(stmt.consequent);
                    const hasNestedIfElse = nestedStmts.some(
                        s => s.type === 'IfStatement' && s.alternate && isSimpleExit(s.alternate)
                    );

                    if (hasNestedIfElse) {
                        parts.push(flattenIfElseChain(stmt, sourceCode, baseIndent));
                    } else {
                        // Keep as is but re-indent
                        parts.push(`${baseIndent}${sourceCode.getText(stmt)}`);
                    }
                } else {
                    // Regular statement - keep as is but re-indent
                    const stmtText = sourceCode.getText(stmt);
                    parts.push(`${baseIndent}${stmtText}`);
                }
            }

            current = null;
        } else if (!current.alternate) {
            // No else branch - check for nested if-else in consequent
            const consequentStmts = getBlockStatements(current.consequent);
            const nestedIfElse = consequentStmts.find(
                s => s.type === 'IfStatement' && s.alternate && isSimpleExit(s.alternate)
            ) as IfStatement | undefined;

            if (nestedIfElse) {
                // Convert the outer if to a guard clause
                const invertedCond = invertCondition(current.test, sourceCode);
                parts.push(`${baseIndent}if (${invertedCond}) return;`);

                // Process the consequent statements
                for (const stmt of consequentStmts) {
                    if (stmt.type === 'IfStatement' && stmt.alternate && isSimpleExit(stmt.alternate)) {
                        parts.push(flattenIfElseChain(stmt, sourceCode, baseIndent));
                    } else if (stmt.type === 'IfStatement') {
                        const nestedStmts = getBlockStatements(stmt.consequent);
                        const hasNestedIfElse = nestedStmts.some(
                            s => s.type === 'IfStatement' && s.alternate && isSimpleExit(s.alternate)
                        );

                        if (hasNestedIfElse) {
                            parts.push(flattenIfElseChain(stmt, sourceCode, baseIndent));
                        } else {
                            parts.push(`${baseIndent}${sourceCode.getText(stmt)}`);
                        }
                    } else {
                        const stmtText = sourceCode.getText(stmt);
                        parts.push(`${baseIndent}${stmtText}`);
                    }
                }
            }

            current = null;
        } else {
            // Has else but it's not a simple exit - can't flatten further
            current = null;
        }
    }

    return parts.join('\n');
}

/**
 * Creates a fix for the if-else chain.
 */
function createFix(
    node: IfStatement,
    sourceCode: SourceCode,
    fixer: Fixer
): Fix {
    const indent = getIndentation(node, sourceCode);
    const fixedCode = flattenIfElseChain(node, sourceCode, indent);

    return fixer.replaceText(node, fixedCode);
}

export const preferEarlyReturnRule = defineRule({
    meta: {
        type: 'suggestion',
        fixable: 'code',
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
        const sourceCode = context.sourceCode;

        return {
            IfStatement(node: ESTree.Node) {
                const ifNode = node as IfStatement;
                if (shouldReportEarlyReturn(ifNode)) {
                    context.report({
                        node,
                        messageId: 'preferEarlyReturn',
                        fix(fixer) {
                            return createFix(ifNode, sourceCode, fixer);
                        },
                    });
                }
            },
        };
    },
});
