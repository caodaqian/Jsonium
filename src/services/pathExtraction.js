function isWhitespace(ch) {
	return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\f' || ch === '\v';
}

function isDigit(ch) {
	return ch >= '0' && ch <= '9';
}

function isIdentifierStart(ch) {
	return /[A-Za-z_$]/.test(ch);
}

function isIdentifierPart(ch) {
	return /[A-Za-z0-9_$]/.test(ch);
}

function skipTrivia(text, index) {
	let cursor = index;
	while (cursor < text.length) {
		const ch = text[cursor];
		if (isWhitespace(ch)) {
			cursor++;
			continue;
		}
		if (ch === '/' && text[cursor + 1] === '/') {
			cursor += 2;
			while (cursor < text.length && text[cursor] !== '\n' && text[cursor] !== '\r') cursor++;
			continue;
		}
		if (ch === '/' && text[cursor + 1] === '*') {
			cursor += 2;
			while (cursor < text.length && !(text[cursor] === '*' && text[cursor + 1] === '/')) cursor++;
			cursor = Math.min(text.length, cursor + 2);
			continue;
		}
		break;
	}
	return cursor;
}

function createNode(type, start, end, path, extra = {}) {
	return {
		type,
		start,
		end,
		path: Array.isArray(path) ? path.slice() : [],
		children: [],
		...extra
	};
}

function parseStringLiteral(text, index) {
	const quote = text[index];
	let cursor = index + 1;
	let value = '';

	while (cursor < text.length) {
		const ch = text[cursor];
		if (ch === '\\') {
			if (cursor + 1 >= text.length) {
				throw new SyntaxError('Unterminated string literal');
			}

			const next = text[cursor + 1];
			value += next;
			cursor += 2;
			continue;
		}

		if (ch === quote) {
			return {
				value,
				end: cursor + 1
			};
		}

		value += ch;
		cursor++;
	}

	throw new SyntaxError('Unterminated string literal');
}

function parseIdentifier(text, index) {
	let cursor = index;
	while (cursor < text.length && isIdentifierPart(text[cursor])) cursor++;
	return {
		value: text.slice(index, cursor),
		end: cursor
	};
}

function parseNumberLiteral(text, index) {
	let cursor = index;
	if (text[cursor] === '-') cursor++;

	if (text[cursor] === '0' && (text[cursor + 1] === 'x' || text[cursor + 1] === 'X')) {
		cursor += 2;
		while (cursor < text.length && /[0-9a-fA-F]/.test(text[cursor])) cursor++;
		return {
			value: text.slice(index, cursor),
			end: cursor
		};
	}

	while (cursor < text.length && isDigit(text[cursor])) cursor++;
	if (text[cursor] === '.') {
		cursor++;
		while (cursor < text.length && isDigit(text[cursor])) cursor++;
	}
	if (text[cursor] === 'e' || text[cursor] === 'E') {
		cursor++;
		if (text[cursor] === '+' || text[cursor] === '-') cursor++;
		while (cursor < text.length && isDigit(text[cursor])) cursor++;
	}

	return {
		value: text.slice(index, cursor),
		end: cursor
	};
}

function parseValue(text, index, path) {
	const cursor = skipTrivia(text, index);
	if (cursor >= text.length) {
		throw new SyntaxError('Unexpected end of JSON input');
	}

	const ch = text[cursor];
	if (ch === '{') {
		return parseObject(text, cursor, path);
	}

	if (ch === '[') {
		return parseArray(text, cursor, path);
	}

	if (ch === '"' || ch === '\'') {
		const parsed = parseStringLiteral(text, cursor);
		return {
			node: createNode('string', cursor, parsed.end, path, { value: parsed.value }),
			end: parsed.end
		};
	}

	if (ch === '-' || isDigit(ch)) {
		const parsed = parseNumberLiteral(text, cursor);
		return {
			node: createNode('number', cursor, parsed.end, path, { value: parsed.value }),
			end: parsed.end
		};
	}

	if (isIdentifierStart(ch)) {
		const parsed = parseIdentifier(text, cursor);
		const allowed = new Set(['true', 'false', 'null', 'Infinity', 'NaN']);
		if (!allowed.has(parsed.value)) {
			throw new SyntaxError(`Unexpected identifier: ${parsed.value}`);
		}

		return {
			node: createNode('literal', cursor, parsed.end, path, { value: parsed.value }),
			end: parsed.end
		};
	}

	throw new SyntaxError(`Unexpected token ${ch}`);
}

function parseObject(text, index, path) {
	const node = createNode('object', index, index + 1, path);
	let cursor = skipTrivia(text, index + 1);

	if (cursor >= text.length) {
		throw new SyntaxError('Unterminated object literal');
	}

	if (text[cursor] === '}') {
		node.end = cursor + 1;
		return {
			node,
			end: cursor + 1
		};
	}

	while (cursor < text.length) {
		cursor = skipTrivia(text, cursor);
		if (cursor >= text.length) {
			throw new SyntaxError('Unterminated object literal');
		}

		const keyStart = cursor;
		let key = '';
		let keyEnd = cursor;

		if (text[cursor] === '"' || text[cursor] === '\'') {
			const parsedKey = parseStringLiteral(text, cursor);
			key = parsedKey.value;
			keyEnd = parsedKey.end;
		} else if (isIdentifierStart(text[cursor])) {
			const parsedKey = parseIdentifier(text, cursor);
			key = parsedKey.value;
			keyEnd = parsedKey.end;
		} else {
			throw new SyntaxError('Invalid object key');
		}

		cursor = skipTrivia(text, keyEnd);
		if (text[cursor] !== ':') {
			throw new SyntaxError('Expected ":" after object key');
		}

		const valuePath = path.concat(key);
		const valueResult = parseValue(text, cursor + 1, valuePath);
		const keyNode = createNode('key', keyStart, keyEnd, valuePath, { key });
		const memberNode = createNode('member', keyStart, valueResult.node.end, valuePath, { key });
		memberNode.children = [keyNode, valueResult.node];
		node.children.push(memberNode);

		cursor = skipTrivia(text, valueResult.end);
		if (cursor >= text.length) {
			throw new SyntaxError('Unterminated object literal');
		}

		if (text[cursor] === ',') {
			cursor = skipTrivia(text, cursor + 1);
			if (cursor < text.length && text[cursor] === '}') {
				node.end = cursor + 1;
				return {
					node,
					end: cursor + 1
				};
			}
			continue;
		}

		if (text[cursor] === '}') {
			node.end = cursor + 1;
			return {
				node,
				end: cursor + 1
			};
		}

		throw new SyntaxError('Expected "," or "}" after object value');
	}

	throw new SyntaxError('Unterminated object literal');
}

function parseArray(text, index, path) {
	const node = createNode('array', index, index + 1, path);
	let cursor = skipTrivia(text, index + 1);

	if (cursor >= text.length) {
		throw new SyntaxError('Unterminated array literal');
	}

	if (text[cursor] === ']') {
		node.end = cursor + 1;
		return {
			node,
			end: cursor + 1
		};
	}

	let itemIndex = 0;
	while (cursor < text.length) {
		const itemPath = path.concat(itemIndex);
		const valueResult = parseValue(text, cursor, itemPath);
		node.children.push(valueResult.node);

		cursor = skipTrivia(text, valueResult.end);
		if (cursor >= text.length) {
			throw new SyntaxError('Unterminated array literal');
		}

		if (text[cursor] === ',') {
			cursor = skipTrivia(text, cursor + 1);
			if (cursor < text.length && text[cursor] === ']') {
				node.end = cursor + 1;
				return {
					node,
					end: cursor + 1
				};
			}
			itemIndex++;
			continue;
		}

		if (text[cursor] === ']') {
			node.end = cursor + 1;
			return {
				node,
				end: cursor + 1
			};
		}

		throw new SyntaxError('Expected "," or "]" after array value');
	}

	throw new SyntaxError('Unterminated array literal');
}

function parseDocument(text) {
	const trimmedStart = skipTrivia(text, 0);
	const parsed = parseValue(text, trimmedStart, []);
	const end = skipTrivia(text, parsed.end);
	return {
		node: createNode('document', 0, text.length, [], { children: [parsed.node] }),
		end,
		valueNode: parsed.node
	};
}

function containsRange(node, start, end) {
	return start >= node.start && end <= node.end;
}

function findDeepestNodeForRange(node, start, end) {
	if (!containsRange(node, start, end)) {
		return null;
	}

	let best = node;
	for (const child of node.children || []) {
		const candidate = findDeepestNodeForRange(child, start, end);
		if (candidate) {
			best = candidate;
		}
	}
	return best;
}

function findDeepestNodeForOffset(node, offset) {
	const target = Math.max(0, Math.min(offset, node.end > 0 ? node.end - 1 : 0));
	return findDeepestNodeForRange(node, target, target + 1);
}

function isSimpleIdentifier(token) {
	return typeof token === 'string' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token);
}

export function formatJsonPath(tokens = []) {
	if (!Array.isArray(tokens) || tokens.length === 0) {
		return '$';
	}

	let path = '$';
	for (const token of tokens) {
		if (typeof token === 'number') {
			path += `[${token}]`;
			continue;
		}

		if (isSimpleIdentifier(token)) {
			path += `.${token}`;
		} else {
			path += `[${JSON.stringify(String(token))}]`;
		}
	}

	return path;
}

export function formatJqPath(tokens = []) {
	if (!Array.isArray(tokens) || tokens.length === 0) {
		return '.';
	}

	let path = '';
	for (const token of tokens) {
		if (typeof token === 'number') {
			path += `[${token}]`;
			continue;
		}

		if (isSimpleIdentifier(token)) {
			path += `.${token}`;
		} else {
			path += path ? `[${JSON.stringify(String(token))}]` : `.[${JSON.stringify(String(token))}]`;
		}
	}

	return path || '.';
}

export function extractPathFromText(text, options = {}) {
	if (typeof text !== 'string' || text.trim() === '') {
		return {
			success: false,
			error: '内容为空'
		};
	}

	try {
		const parsed = parseDocument(text);
		const root = parsed.node;
		let node = null;
		let source = 'cursor';

		if (
			Number.isInteger(options.selectionStart)
			&& Number.isInteger(options.selectionEnd)
			&& options.selectionEnd > options.selectionStart
		) {
			const selectionNode = findDeepestNodeForRange(root, options.selectionStart, options.selectionEnd);
			if (selectionNode && Array.isArray(selectionNode.path) && selectionNode.path.length > 0) {
				node = selectionNode;
				source = 'selection';
			}
		}

		if (!node && Number.isInteger(options.cursorOffset)) {
			node = findDeepestNodeForOffset(root, options.cursorOffset);
		}

		if (!node) {
			return {
				success: false,
				error: '无法定位光标所在节点'
			};
		}

		const tokens = Array.isArray(node.path) ? node.path : [];
		return {
			success: true,
			source,
			nodeType: node.type,
			tokens,
			jsonpath: formatJsonPath(tokens),
			jq: formatJqPath(tokens),
			range: {
				start: node.start,
				end: node.end
			},
			value: node.value ?? null
		};
	} catch (error) {
		return {
			success: false,
			error: error && error.message ? error.message : '路径提取失败'
		};
	}
}

export default {
	extractPathFromText,
	formatJsonPath,
	formatJqPath
};