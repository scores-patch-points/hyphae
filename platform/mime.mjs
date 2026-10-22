// RFC 5322 message builder for users.messages.send. Plain text, UTF-8.
const bad = /[\r\n]/;

function addr(a) {
  const s = String(a || "").trim();
  if (bad.test(s) || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(s)) throw new Error(`invalid address: ${JSON.stringify(a)}`);
  return s;
}

const wrap = (b64) => b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();

export function buildRaw({ from, to, subject, text, inReplyTo }) {
  const subj = String(subject ?? "");
  if (bad.test(subj)) throw new Error("subject must be one line");
  const headers = [
    `From: ${addr(from)}`,
    `To: ${(Array.isArray(to) ? to : [to]).map(addr).join(", ")}`,
    `Subject: =?UTF-8?B?${Buffer.from(subj, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  if (inReplyTo) {
    if (bad.test(inReplyTo)) throw new Error("bad In-Reply-To");
    headers.push(`In-Reply-To: ${inReplyTo}`);
  }
  const msg = headers.join("\r\n") + "\r\n\r\n" + wrap(Buffer.from(String(text ?? ""), "utf8").toString("base64"));
  return Buffer.from(msg).toString("base64url");
}
