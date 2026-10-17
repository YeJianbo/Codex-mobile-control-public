// Lightweight syntax highlighting for chat code blocks. Zero dependencies:
// tokenizes with a hand-rolled scanner and emits span.tok-* nodes via the DOM
// (no innerHTML), so output is injection-safe by construction. Colors live in
// console.css under --code-* and follow the light/dark theme.

const KEYWORDS = {
  js: "as async await break case catch class const continue debugger default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of package private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while with yield",
  java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends false final finally float for goto if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true try void volatile while var record sealed yield",
  kt: "as break by catch class companion const constructor continue crossinline do dynamic else enum expect external false final finally for fun get if import in infix init inline inner interface internal is lateinit lazy null object open operator out override package private protected public reified return sealed set super suspend this throw true try typealias typeof val var vararg when where while",
  c: "auto break case char const continue default do double else enum extern false float for goto if inline int long NULL register restrict return short signed sizeof static struct switch typedef true union unsigned void volatile while nullptr nullptr_t",
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota make new len cap append copy delete panic recover",
  rs: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
  py: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case self",
  sql: "select insert update delete from where join left right inner outer full on group by order having limit offset as and or not null is in between like exists union all distinct create table alter drop index view primary key foreign references default constraint values set into add",
  sh: "if then else elif fi for while until do done case esac function return exit local export readonly shift break continue echo cd source set unset trap in",
};

const FAMILY = {
  js: "clike", java: "clike", kt: "clike", c: "clike", cpp: "clike", cs: "clike",
  go: "clike", rs: "clike", rb: "ruby", php: "clike", swift: "clike", scala: "clike",
  py: "python", python: "python",
  bash: "shell", sh: "shell", shell: "shell", zsh: "shell", ps1: "shell", dockerfile: "shell",
  json: "json", jsonc: "json", json5: "json",
  html: "markup", xml: "markup", svg: "markup", vue: "markup", wxl: "markup",
  css: "css", scss: "css", less: "css",
  yml: "yaml", yaml: "yaml", toml: "yaml", ini: "yaml", conf: "yaml",
  sql: "sql", diff: "diff", patch: "diff",
};

const ALIASES = {
  javascript: "js", jsx: "js", mjs: "js", cjs: "js", ts: "js", tsx: "js", node: "js", typescript: "js",
  kotlin: "kt", "c++": "cpp", h: "cpp", hpp: "cpp", cc: "cpp", cxx: "cpp", csharp: "cs",
  rust: "rs", ruby: "rb", golang: "go", python3: "py", ansible: "yaml", properties: "yaml",
  plaintext: "", text: "", txt: "", log: "", console: "", output: "",
};

const MAX_SOURCE_LENGTH = 60 * 1024;

const isWordChar = (ch) => /[A-Za-z0-9_$]/.test(ch);
const isDigit = (ch) => ch >= "0" && ch <= "9";

function tokenizeClike(text, lang, emit) {
  const words = new Set((KEYWORDS[lang] || KEYWORDS.js).split(" "));
  const literals = new Set(["true", "false", "null", "undefined", "nil", "None", "True", "False"]);
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === "/" && text[i + 1] === "/") {
      let end = text.indexOf("\n", i);
      if (end === -1) end = n;
      emit("com", text.slice(i, end));
      i = end;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      let end = text.indexOf("*/", i + 2);
      end = end === -1 ? n : end + 2;
      emit("com", text.slice(i, end));
      i = end;
      continue;
    }
    if (ch === "#") {
      let end = text.indexOf("\n", i);
      if (end === -1) end = n;
      emit("com", text.slice(i, end));
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === ch) { j++; break; }
        if (ch !== "`" && text[j] === "\n") break;
        j++;
      }
      emit("str", text.slice(i, j));
      i = j;
      continue;
    }
    if (isDigit(ch) && !isWordChar(text[i - 1] || "")) {
      let j = i;
      while (j < n && /[0-9a-fA-FoOxXbB._]/.test(text[j])) j++;
      emit("num", text.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z_$@]/.test(ch)) {
      let j = i + 1;
      while (j < n && isWordChar(text[j])) j++;
      const word = text.slice(i, j);
      let k = j;
      while (k < n && (text[k] === " " || text[k] === "\t")) k++;
      if (words.has(lang === "sql" ? word.toLowerCase() : word)) emit("kw", word);
      else if (literals.has(word)) emit("num", word);
      else if (text[k] === "(") emit("fn", word);
      else emit("", word);
      i = j;
      continue;
    }
    let j = i;
    while (j < n && !/[A-Za-z0-9_$@#'"`\/]/.test(text[j]) && !(/[0-9]/.test(text[j]) && !isWordChar(text[j - 1] || ""))) j++;
    if (j === i) j = i + 1;
    emit("", text.slice(i, j));
    i = j;
  }
}

function tokenizePython(text, lang, emit) {
  const words = new Set((KEYWORDS.py).split(" "));
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === "#") {
      let end = text.indexOf("\n", i);
      if (end === -1) end = n;
      emit("com", text.slice(i, end));
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const triple = text.slice(i, i + 3) === ch.repeat(3);
      const close = ch.repeat(triple ? 3 : 1);
      let j = i + close.length;
      while (j < n) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text.startsWith(close, j)) { j += close.length; break; }
        j++;
      }
      emit("str", text.slice(i, j));
      i = j;
      continue;
    }
    if (isDigit(ch) && !isWordChar(text[i - 1] || "")) {
      let j = i;
      while (j < n && /[0-9a-fA-FoOxXbB._]/.test(text[j])) j++;
      emit("num", text.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && isWordChar(text[j])) j++;
      const word = text.slice(i, j);
      let k = j;
      while (k < n && (text[k] === " " || text[k] === "\t")) k++;
      if (words.has(word)) emit("kw", word);
      else if (text[k] === "(") emit("fn", word);
      else emit("", word);
      i = j;
      continue;
    }
    emit("", ch);
    i++;
  }
}

function tokenizeShell(text, emit) {
  const words = new Set(KEYWORDS.sh.split(" "));
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === "#") {
      let end = text.indexOf("\n", i);
      if (end === -1) end = n;
      emit("com", text.slice(i, end));
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === ch) { j++; break; }
        j++;
      }
      emit("str", text.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z_-]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_=\-]/.test(text[j])) j++;
      const word = text.slice(i, j);
      emit(words.has(word) ? "kw" : "", word);
      i = j;
      continue;
    }
    emit("", ch);
    i++;
  }
}

function tokenizeMarkup(text, emit) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text.startsWith("<!--", i)) {
      let end = text.indexOf("-->", i);
      end = end === -1 ? n : end + 3;
      emit("com", text.slice(i, end));
      i = end;
      continue;
    }
    if (text[i] === "<") {
      let j = i + 1;
      let tag = "";
      if (text[j] === "/") j++;
      while (j < n && /[A-Za-z0-9_:-]/.test(text[j])) tag += text[j++];
      emit("tag", text.slice(i, j));
      i = j;
      // attributes until '>'
      while (i < n && text[i] !== ">") {
        if (text[i] === '"' || text[i] === "'") {
          let k = i + 1;
          while (k < n && text[k] !== text[i]) k++;
          k = Math.min(k + 1, n);
          emit("str", text.slice(i, k));
          i = k;
          continue;
        }
        if (/[A-Za-z_-]/.test(text[i])) {
          let k = i;
          while (k < n && /[A-Za-z0-9_:-]/.test(text[k])) k++;
          emit("attr", text.slice(i, k));
          i = k;
          continue;
        }
        emit("", text[i]);
        i++;
      }
      continue;
    }
    let j = text.indexOf("<", i);
    if (j === -1) j = n;
    if (j === i) j = i + 1;
    emit("", text.slice(i, j));
    i = j;
  }
}

function tokenizeCss(text, emit) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text.startsWith("/*", i)) {
      let end = text.indexOf("*/", i + 2);
      end = end === -1 ? n : end + 2;
      emit("com", text.slice(i, end));
      i = end;
      continue;
    }
    if (text[i] === '"' || text[i] === "'") {
      let j = i + 1;
      while (j < n) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === text[i]) { j++; break; }
        j++;
      }
      emit("str", text.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z_-]/.test(text[i])) {
      let j = i;
      while (j < n && /[A-Za-z0-9_-]/.test(text[j])) j++;
      const word = text.slice(i, j);
      let k = j;
      while (k < n && /\s/.test(text[k])) k++;
      emit(text[k] === ":" ? "attr" : "", word);
      i = j;
      continue;
    }
    if (isDigit(text[i])) {
      let j = i;
      while (j < n && /[0-9.%a-z]/.test(text[j])) j++;
      emit("num", text.slice(i, j));
      i = j;
      continue;
    }
    emit("", text[i]);
    i++;
  }
}

function tokenizeYaml(text, emit) {
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    const comment = line.indexOf("#");
    const key = /^[ \t]*[A-Za-z0-9_.-]+(?=\s*:)/.exec(line);
    let rest = line;
    if (key) {
      emit("attr", key[0]);
      rest = line.slice(key[0].length);
    }
    if (comment !== -1 && (key === null || comment >= key[0].length)) {
      const head = rest.slice(0, comment - (key ? key[0].length : 0));
      if (head) emit("", head);
      emit("com", rest.slice(comment - (key ? key[0].length : 0)));
    } else {
      if (rest) emit("", rest);
    }
    if (index < lines.length - 1) emit("", "\n");
  });
}

function tokenizeJson(text, emit) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (text[i] === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === "\\") { j += 2; continue; }
        if (text[j] === '"') { j++; break; }
        j++;
      }
      let k = j;
      while (k < n && /\s/.test(text[k])) k++;
      emit(text[k] === ":" ? "attr" : "str", text.slice(i, j));
      i = j;
      continue;
    }
    if (isDigit(text[i]) || (text[i] === "-" && isDigit(text[i + 1]))) {
      let j = i + 1;
      while (j < n && /[0-9.eE+-]/.test(text[j])) j++;
      emit("num", text.slice(i, j));
      i = j;
      continue;
    }
    if (/[a-z]/.test(text[i])) {
      let j = i;
      while (j < n && /[a-z]/.test(text[j])) j++;
      emit("num", text.slice(i, j));
      i = j;
      continue;
    }
    emit("", text[i]);
    i++;
  }
}

function tokenizeDiff(text, emit) {
  for (const line of text.split(/(?<=\n)/)) {
    if (/^\+\+\+|^---/.test(line)) emit("", line);
    else if (line.startsWith("+")) emit("add", line);
    else if (line.startsWith("-")) emit("del", line);
    else if (line.startsWith("@@")) emit("hunk", line);
    else emit("", line);
  }
}

function tokenize(text, langId) {
  const nodes = [];
  const emit = (type, value) => {
    if (!value) return;
    if (type) {
      const span = document.createElement("span");
      span.className = `tok-${type}`;
      span.textContent = value;
      nodes.push(span);
    } else {
      nodes.push(document.createTextNode(value));
    }
  };
  const family = FAMILY[langId];
  if (family === "clike") tokenizeClike(text, langId, emit);
  else if (family === "sql") tokenizeClike(text, "sql", emit);
  else if (family === "python") tokenizePython(text, langId, emit);
  else if (family === "shell") tokenizeShell(text, emit);
  else if (family === "markup") tokenizeMarkup(text, emit);
  else if (family === "css") tokenizeCss(text, emit);
  else if (family === "yaml") tokenizeYaml(text, emit);
  else if (family === "json") tokenizeJson(text, emit);
  else if (family === "diff") tokenizeDiff(text, emit);
  else nodes.push(document.createTextNode(text));
  return nodes;
}

export function highlightCodeElement(code) {
  const classEntry = [...code.classList].find((name) => name.startsWith("language-"));
  let langId = classEntry ? classEntry.slice("language-".length).toLowerCase() : "";
  langId = ALIASES[langId] !== undefined ? ALIASES[langId] : langId;
  const source = code.textContent;
  if (!source || source.length > MAX_SOURCE_LENGTH || !FAMILY[langId]) return false;
  if (code.dataset.highlighted === "1") return true;
  try {
    code.replaceChildren(...tokenize(source, langId));
    code.dataset.highlighted = "1";
    return true;
  } catch {
    return false;
  }
}
