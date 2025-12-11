
const fs = require('fs');
const path = require('path');

function parseMarkdown(text) {
	if (!text) return "";

	// 1. Extract Math (Block $$...$$ and Inline $...$) to placeholders
	const mathPlaceholders = [];
	let processedText = String(text);

	// Block Math
	processedText = processedText.replace(/\$\$([\s\S]*?)\$\$/g, (match, tex) => {
		const id = `__MATH_BLOCK_${mathPlaceholders.length}__`;
		mathPlaceholders.push({ id, tex, displayMode: true });
		return id;
	});

	// Inline Math (avoid matching currency like $100)
	// Heuristic: $ followed by non-space, ending with non-space $
	processedText = processedText.replace(/(^|[^\\])\$([^\s\$].*?[^\s\$])\$/g, (match, prefix, tex) => {
		const id = `__MATH_INLINE_${mathPlaceholders.length}__`;
		mathPlaceholders.push({ id, tex, displayMode: false });
		return prefix + id;
	});

	// 2. Escape HTML
	let safeText = processedText
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");

	// 3. Apply Markdown Syntax (Recursive)
	safeText = applyMarkdownSyntax(safeText);

	return safeText;
}

function applyMarkdownSyntax(text) {
	let safeText = text;

	// Blockquotes (Recursive)
	// Match lines starting with &gt; (and optional space)
	safeText = safeText.replace(/(?:^&gt; ?.*(?:\r?\n|$))+/gm, (match) => {
		// Remove &gt; and leading space from each line
		const content = match.replace(/^&gt; ?/gm, '');
		
		// Check for 'Prompt' style (heuristic: starts with 'Prompt' or '**Prompt**')
		const isPrompt = /^\s*(?:\*\*|<strong>)?Prompt(?:\*\*|:|<\/strong>)/i.test(content);
		
		const innerHtml = applyMarkdownSyntax(content);
		
		if (isPrompt) {
			return `<div class='wealth-prompt'>${innerHtml}</div>`;
		}
		return `<blockquote>${innerHtml}</blockquote>`;
	});

	// Tables (Basic support)
	safeText = safeText.replace(/((?:^\s*\|.*(?:\r?\n|$))+)/gm, (match) => {
		const lines = match.trim().split(/\r?\n/);
		if (lines.length < 2) return match; // Not a table

		let html = '<div class=\'wealth-table-wrapper\'><table>';
		let isHeader = true;

		lines.forEach((line, index) => {
			const trimmedLine = line.trim();
			if (trimmedLine.match(/^\|[\s:-]+(?:\||$)/)) {
				// Separator line
				isHeader = false;
				return;
			}
			
			let cells = line.split('|');
			if (trimmedLine.startsWith('|')) cells.shift();
			if (trimmedLine.endsWith('|')) cells.pop();
			
			if (cells.length === 0) return;

			html += '<tr>';
			cells.forEach(cell => {
				const tag = (index === 0) ? 'th' : 'td';
				html += `<${tag}>${applyMarkdownInline(cell.trim())}</${tag}>`;
			});
			html += '</tr>';
		});

		html += '</table></div>';
		return html;
	});

	// Lists
	// Unordered: * item or - item
	safeText = safeText.replace(/^\s*[\-\*]\s+(.*)$/gm, (match, item) => {
		return `<div class='wealth-li'>• ${applyMarkdownInline(item)}</div>`;
	});
	
	// Nested Unordered
	safeText = safeText.replace(/^\s{2,}[\-\*]\s+(.*)$/gm, (match, item) => {
		return `<div class='wealth-li wealth-li--nested'>• ${applyMarkdownInline(item)}</div>`;
	});

	// Headers
	safeText = safeText.replace(/^### (.*$)/gm, '<h3>$1</h3>');
	safeText = safeText.replace(/^#### (.*$)/gm, '<h4>$1</h4>');

	// Inline Formatting (Bold, Italic, Code)
	safeText = applyMarkdownInline(safeText);

	// Newlines to <br> (but not inside tables or headers or blockquotes or prompts)
	safeText = safeText.replace(/\n/g, '<br>');
	
	// Cleanup <br> around block elements
	safeText = safeText.replace(/<\/h3><br>/g, '</h3>');
	safeText = safeText.replace(/<\/h4><br>/g, '</h4>');
	safeText = safeText.replace(/<\/table><\/div><br>/g, '</table></div>');
	safeText = safeText.replace(/<\/div><br>/g, '</div>');
	safeText = safeText.replace(/<\/blockquote><br>/g, '</blockquote>');
	safeText = safeText.replace(/<\/div><br><h3>/g, '</div><h3>');

	return safeText;
}

function applyMarkdownInline(text) {
	let safeText = text;
	// Bold
	safeText = safeText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
	// Italics
	safeText = safeText.replace(/([^\*]|^)\*([^\s\*](?:.*?[^\s\*])?)\*/g, '$1<em>$2</em>');
    return safeText;
}

const jsonPath = path.join(__dirname, 'data/ai/trade/trade-daily.json');
const jsonContent = fs.readFileSync(jsonPath, 'utf8');
const data = JSON.parse(jsonContent);

// Assuming the first item has the content we want
const content = data[0].markdown_content.zh;

console.log("--- Processing Content ---");
const result = parseMarkdown(content);

// Find where the table is in the result
const resStart = result.indexOf('<strong>1. 决策矩阵（表格）</strong>');
if (resStart !== -1) {
    console.log("Result Text Segment:");
    console.log(result.substring(resStart, resStart + 1000));
} else {
    console.log("Table title not found in output.");
}
