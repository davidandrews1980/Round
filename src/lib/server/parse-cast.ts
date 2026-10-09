export type ParsedCast = {
  say: string;
  whispers: { to: string; text: string }[];
  ideas: string[];
  mcp: { server: string; tool: string; args: string }[];
};

export function parseCastReply(raw: string): ParsedCast {
  const whispers: ParsedCast["whispers"] = [];
  const ideas: string[] = [];
  const mcp: ParsedCast["mcp"] = [];
  let say = raw ?? "";

  say = say.replace(/<whisper\s+to="([^"]*)"\s*>([\s\S]*?)<\/whisper>/gi, (_, to, text) => {
    const body = String(text ?? "").trim();
    const target = String(to ?? "").trim();
    if (body && target) whispers.push({ to: target, text: body.slice(0, 500) });
    return "";
  });
  say = say.replace(/<idea>([\s\S]*?)<\/idea>/gi, (_, text) => {
    const body = String(text ?? "").trim();
    if (body) ideas.push(body.slice(0, 400));
    return "";
  });
  say = say.replace(
    /<mcp\s+server="([^"]*)"\s+tool="([^"]*)"\s*>([\s\S]*?)<\/mcp>/gi,
    (_, server, tool, args) => {
      const name = String(server ?? "").trim();
      const toolName = String(tool ?? "").trim();
      if (name && toolName) {
        mcp.push({
          server: name.slice(0, 80),
          tool: toolName.slice(0, 80),
          args: String(args ?? "").trim().slice(0, 2000),
        });
      }
      return "";
    },
  );

  return { say: say.trim(), whispers, ideas, mcp: mcp.slice(0, 1) };
}
