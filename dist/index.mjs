import { definePlugin, defineRule } from "oxlint";

//#region src/prefer-early-return.ts
/**
* Gets the statements from a block statement or wraps a single statement.
*/
function getBlockStatements(statement) {
	if (statement.type === "BlockStatement") return statement.body;
	return [statement];
}
/**
* Checks if a node is a function-like node.
*/
function isFunctionNode(node) {
	return node.type === "FunctionDeclaration" || node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression" || node.type.includes("Function");
}
/**
* Checks if the parent block is a function body.
*/
function isDirectlyInFunctionBody(node) {
	const parent = node.parent;
	if (parent.type !== "BlockStatement") return false;
	const grandParent = parent.parent;
	return isFunctionNode(grandParent) || grandParent.type === "MethodDefinition";
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
function hasNestedIfInConsequent(node) {
	const consequentStatements = getBlockStatements(node.consequent);
	for (const stmt of consequentStatements) if (stmt.type === "IfStatement") return true;
	return false;
}
/**
* Checks if a statement is a simple exit (return, throw, or single expression).
* In the context of if-else chains, even expression statements in else branches
* indicate an early exit pattern (e.g., res.status(401).send("Unauthorized")).
*/
function isSimpleExit(statement) {
	if (!statement) return false;
	if (statement.type === "ReturnStatement" || statement.type === "ThrowStatement" || statement.type === "ExpressionStatement") return true;
	if (statement.type === "BlockStatement") {
		const body = statement.body;
		if (body.length === 1) return isSimpleExit(body[0]);
	}
	return false;
}
/**
* Checks if the given if statement is the last statement in its block.
*/
function isLastStatementInBlock(node) {
	const parent = node.parent;
	if (parent.type !== "BlockStatement" || !("body" in parent) || !Array.isArray(parent.body)) return false;
	const body = parent.body;
	return body.indexOf(node) === body.length - 1;
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
function shouldReportEarlyReturn(node) {
	if (!isDirectlyInFunctionBody(node)) return false;
	if (!isLastStatementInBlock(node)) return false;
	if (node.alternate !== null) {
		if (isSimpleExit(node.alternate) && hasNestedIfInConsequent(node)) return true;
		return false;
	}
	const consequentStatements = getBlockStatements(node.consequent);
	for (const stmt of consequentStatements) if (stmt.type === "IfStatement" && stmt.alternate !== null) {
		if (isSimpleExit(stmt.alternate)) return true;
	}
	return false;
}
/**
* Gets the simple exit statement from a block or statement.
*/
function getSimpleExitStatement(statement) {
	if (statement.type === "BlockStatement" && statement.body.length === 1) return getSimpleExitStatement(statement.body[0]);
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
function invertCondition(condition, sourceCode) {
	const conditionText = sourceCode.getText(condition);
	if (condition.type === "UnaryExpression" && condition.operator === "!") {
		const argument = condition.argument;
		if (argument.type === "Identifier" || argument.type === "MemberExpression" || argument.type === "CallExpression") return sourceCode.getText(argument);
		return `(${sourceCode.getText(argument)})`;
	}
	if (condition.type === "BinaryExpression") {
		const left = sourceCode.getText(condition.left);
		const right = sourceCode.getText(condition.right);
		switch (condition.operator) {
			case "===": return `${left} !== ${right}`;
			case "!==": return `${left} === ${right}`;
			case "==": return `${left} != ${right}`;
			case "!=": return `${left} == ${right}`;
			case "<": return `${left} >= ${right}`;
			case "<=": return `${left} > ${right}`;
			case ">": return `${left} <= ${right}`;
			case ">=": return `${left} < ${right}`;
		}
	}
	if (condition.type === "Identifier" || condition.type === "MemberExpression" || condition.type === "CallExpression") return `!${conditionText}`;
	return `!(${conditionText})`;
}
/**
* Converts an exit statement to a return statement if needed.
* - ReturnStatement stays as is
* - ThrowStatement stays as is
* - ExpressionStatement becomes `return <expression>;`
*/
function convertToEarlyReturn(statement, sourceCode) {
	const exitStmt = getSimpleExitStatement(statement);
	if (exitStmt.type === "ReturnStatement" || exitStmt.type === "ThrowStatement") return sourceCode.getText(exitStmt);
	if (exitStmt.type === "ExpressionStatement") return `return ${sourceCode.getText(exitStmt.expression)};`;
	return sourceCode.getText(exitStmt);
}
/**
* Gets the indentation of a node based on its position.
*/
function getIndentation(node, sourceCode) {
	const text = sourceCode.getText();
	const start = node.start;
	let lineStart = start;
	while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--;
	let indent = "";
	for (let i = lineStart; i < start; i++) if (text[i] === " " || text[i] === "	") indent += text[i];
	else break;
	return indent;
}
/**
* Recursively flattens nested if-else chains into early returns.
*/
function flattenIfElseChain(node, sourceCode, baseIndent) {
	const parts = [];
	let current = node;
	while (current) if (current.alternate && isSimpleExit(current.alternate)) {
		const invertedCond = invertCondition(current.test, sourceCode);
		const earlyReturn = convertToEarlyReturn(current.alternate, sourceCode);
		parts.push(`${baseIndent}if (${invertedCond}) ${earlyReturn}`);
		const consequentStmts = getBlockStatements(current.consequent);
		for (const stmt of consequentStmts) if (stmt.type === "IfStatement" && stmt.alternate && isSimpleExit(stmt.alternate)) parts.push(flattenIfElseChain(stmt, sourceCode, baseIndent));
		else if (stmt.type === "IfStatement" && !stmt.alternate) if (getBlockStatements(stmt.consequent).some((s) => s.type === "IfStatement" && s.alternate && isSimpleExit(s.alternate))) parts.push(flattenIfElseChain(stmt, sourceCode, baseIndent));
		else parts.push(`${baseIndent}${sourceCode.getText(stmt)}`);
		else {
			const stmtText = sourceCode.getText(stmt);
			parts.push(`${baseIndent}${stmtText}`);
		}
		current = null;
	} else if (!current.alternate) {
		const consequentStmts = getBlockStatements(current.consequent);
		if (consequentStmts.find((s) => s.type === "IfStatement" && s.alternate && isSimpleExit(s.alternate))) {
			const invertedCond = invertCondition(current.test, sourceCode);
			parts.push(`${baseIndent}if (${invertedCond}) return;`);
			for (const stmt of consequentStmts) if (stmt.type === "IfStatement" && stmt.alternate && isSimpleExit(stmt.alternate)) parts.push(flattenIfElseChain(stmt, sourceCode, baseIndent));
			else if (stmt.type === "IfStatement") if (getBlockStatements(stmt.consequent).some((s) => s.type === "IfStatement" && s.alternate && isSimpleExit(s.alternate))) parts.push(flattenIfElseChain(stmt, sourceCode, baseIndent));
			else parts.push(`${baseIndent}${sourceCode.getText(stmt)}`);
			else {
				const stmtText = sourceCode.getText(stmt);
				parts.push(`${baseIndent}${stmtText}`);
			}
		}
		current = null;
	} else current = null;
	return parts.join("\n");
}
/**
* Creates a fix for the if-else chain.
*/
function createFix(node, sourceCode, fixer) {
	const fixedCode = flattenIfElseChain(node, sourceCode, getIndentation(node, sourceCode));
	return fixer.replaceText(node, fixedCode);
}
const preferEarlyReturnRule = defineRule({
	meta: {
		type: "suggestion",
		fixable: "code",
		docs: {
			description: "Prefer early returns to reduce nesting and improve code readability",
			recommended: false
		},
		messages: { preferEarlyReturn: "Prefer early returns to reduce nesting. Invert the condition and return early instead of wrapping code in an if-else." },
		schema: []
	},
	create(context) {
		const sourceCode = context.sourceCode;
		return { IfStatement(node) {
			const ifNode = node;
			if (shouldReportEarlyReturn(ifNode)) context.report({
				node,
				messageId: "preferEarlyReturn",
				fix(fixer) {
					return createFix(ifNode, sourceCode, fixer);
				}
			});
		} };
	}
});

//#endregion
//#region src/index.ts
const plugin = definePlugin({
	meta: { name: "eslint-plugin-prefer-early-return" },
	rules: { "prefer-early-return": preferEarlyReturnRule }
});
var src_default = plugin;

//#endregion
export { src_default as default, plugin, preferEarlyReturnRule };