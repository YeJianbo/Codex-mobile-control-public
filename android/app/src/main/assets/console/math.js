import katex from "./katex.js";
export const mathExtension = {
  name: "math",
  level: "inline",
  start(src) {
    const index = src.search(/\$|\\[([]/);
    return index < 0 ? void 0 : index;
  },
  tokenizer(src) {
    const pairs = [[/^\$\$([\s\S]+?)\$\$/, "block"], [/^\\\[([\s\S]+?)\\\]/, "block"], [/^\\\(([\s\S]+?)\\\)/, "inline"], [/^\$([^$\n]+?)\$/, "inline"]];
    for (const [pattern, display] of pairs) {
      const match = pattern.exec(src);
      if (match) return { type: "math", raw: match[0], text: match[1], display };
    }
  },
  renderer(token) {
    return `<span data-formula="${encodeURIComponent(token.text)}" data-display="${token.display}"></span>`;
  }
};
export function renderMath(root) {
  root.querySelectorAll("[data-formula]").forEach((node) => {
    katex.render(decodeURIComponent(node.dataset.formula), node, { displayMode: node.dataset.display === "block", throwOnError: false, trust: false, strict: "ignore", output: "htmlAndMathml" });
  });
}
