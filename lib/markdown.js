// Minimal markdown → React: headings, bold, lists, rules and paragraphs.
// Shared by Amp and Spark.

export function parseInline(text, key) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : part
  );
}

export function renderMarkdown(text) {
  if (!text) return null;
  return text.split(/\r?\n/).map((rawLine, i) => {
    const line = rawLine.trimEnd();
    const h3 = line.match(/^###\s+(.+)/);  if (h3) return <h3 key={i} className="md-h3">{parseInline(h3[1])}</h3>;
    const h2 = line.match(/^##\s+(.+)/);   if (h2) return <h2 key={i} className="md-h2">{parseInline(h2[1])}</h2>;
    const h1 = line.match(/^#\s+(.+)/);    if (h1) return <h1 key={i} className="md-h1">{parseInline(h1[1])}</h1>;
    if (line.trim() === "---" || line.trim() === "***") return <hr key={i} className="md-hr" />;
    if (/^[\s]*[-*+] /.test(line)) return <li key={i} className="md-li">{parseInline(line.replace(/^[\s]*[-*+] /, ""))}</li>;
    if (/^\d+\. /.test(line))      return <li key={i} className="md-li md-oli">{parseInline(line.replace(/^\d+\. /, ""))}</li>;
    if (line.trim() === "")        return <div key={i} className="md-spacer" />;
    return <p key={i} className="md-p">{parseInline(line)}</p>;
  });
}

