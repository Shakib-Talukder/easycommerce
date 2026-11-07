/**
 * Docker-free stand-in for Redis in local development: a tiny in-process
 * server that speaks RESP2 and implements only the commands this repo uses
 * (GET, SET EX, DEL, GETDEL, INCR, EXPIRE [NX], TTL, MULTI/EXEC, PING, INFO).
 * It lets `next start` (NODE_ENV=production, which refuses the in-memory
 * fallback) run locally against the real Redis adapter.
 *
 *   pnpm redis:local        # listens on 127.0.0.1:6379
 *
 * Not a Redis replacement: single process, no persistence, no auth.
 */
import net from "node:net";

const port = Number(process.env.REDIS_PORT ?? 6379);
const data = new Map<string, { value: string; expiresAt: number | null }>();

type Reply = string | number | null | Reply[] | { error: string } | { status: string };

const encode = (r: Reply): string => {
  if (r === null) return "$-1\r\n";
  if (typeof r === "number") return `:${r}\r\n`;
  if (typeof r === "string") return `$${Buffer.byteLength(r)}\r\n${r}\r\n`;
  if (Array.isArray(r)) return `*${r.length}\r\n${r.map(encode).join("")}`;
  if ("error" in r) return `-${r.error}\r\n`;
  return `+${r.status}\r\n`;
};

const OK = { status: "OK" };

function live(key: string) {
  const entry = data.get(key);
  if (entry?.expiresAt !== null && entry !== undefined && entry.expiresAt <= Date.now()) {
    data.delete(key);
    return undefined;
  }
  return entry;
}

function run(args: string[]): Reply {
  const [rawName = "", ...a] = args;
  const name = rawName.toUpperCase();
  switch (name) {
    case "PING":
      return a[0] ?? { status: "PONG" };
    case "ECHO":
      return a[0] ?? "";
    case "INFO":
      return "# Server\r\nredis_version:7.2.0-local\r\nloading:0\r\n";
    case "SELECT":
    case "CLIENT":
    case "QUIT":
      return OK;
    case "GET":
      return live(a[0]!)?.value ?? null;
    case "SET": {
      const [key, value, ...opts] = a;
      let expiresAt: number | null = null;
      for (let i = 0; i < opts.length; i++) {
        const opt = opts[i]!.toUpperCase();
        if (opt === "EX") expiresAt = Date.now() + Number(opts[++i]) * 1000;
        else if (opt === "PX") expiresAt = Date.now() + Number(opts[++i]);
        else if (opt === "NX" && live(key!)) return null;
      }
      data.set(key!, { value: value!, expiresAt });
      return OK;
    }
    case "DEL":
      return a.reduce((n, key) => (live(key) && data.delete(key) ? n + 1 : n), 0);
    case "GETDEL": {
      const value = live(a[0]!)?.value ?? null;
      data.delete(a[0]!);
      return value;
    }
    case "INCR": {
      const entry = live(a[0]!);
      const next = Number(entry?.value ?? 0) + 1;
      if (!Number.isInteger(next)) return { error: "ERR value is not an integer or out of range" };
      data.set(a[0]!, { value: String(next), expiresAt: entry?.expiresAt ?? null });
      return next;
    }
    case "EXPIRE": {
      const entry = live(a[0]!);
      if (!entry) return 0;
      if (a[2]?.toUpperCase() === "NX" && entry.expiresAt !== null) return 0;
      entry.expiresAt = Date.now() + Number(a[1]) * 1000;
      return 1;
    }
    case "TTL": {
      const entry = live(a[0]!);
      if (!entry) return -2;
      return entry.expiresAt === null ? -1 : Math.ceil((entry.expiresAt - Date.now()) / 1000);
    }
    case "FLUSHALL":
    case "FLUSHDB":
      data.clear();
      return OK;
    default:
      return { error: `ERR unknown command '${rawName}' (local-redis supports a small subset)` };
  }
}

/** Parses complete RESP arrays (or inline commands) from the buffer; returns the rest. */
function parse(buffer: Buffer, onCommand: (args: string[]) => void): Buffer {
  let offset = 0;
  for (;;) {
    if (offset >= buffer.length) return Buffer.alloc(0);
    if (buffer[offset] !== 0x2a /* '*' */) {
      const end = buffer.indexOf("\r\n", offset);
      if (end === -1) return buffer.subarray(offset);
      const line = buffer.subarray(offset, end).toString().trim();
      offset = end + 2;
      if (line) onCommand(line.split(/\s+/));
      continue;
    }
    const headerEnd = buffer.indexOf("\r\n", offset);
    if (headerEnd === -1) return buffer.subarray(offset);
    const count = Number(buffer.subarray(offset + 1, headerEnd).toString());
    let cursor = headerEnd + 2;
    const args: string[] = [];
    for (let i = 0; i < count; i++) {
      const lenEnd = buffer.indexOf("\r\n", cursor);
      if (lenEnd === -1) return buffer.subarray(offset);
      const len = Number(buffer.subarray(cursor + 1, lenEnd).toString());
      const start = lenEnd + 2;
      if (buffer.length < start + len + 2) return buffer.subarray(offset);
      args.push(buffer.subarray(start, start + len).toString());
      cursor = start + len + 2;
    }
    offset = cursor;
    onCommand(args);
  }
}

const server = net.createServer((socket) => {
  let pending: Buffer = Buffer.alloc(0);
  let queue: string[][] | null = null; // MULTI queue

  socket.on("data", (chunk) => {
    pending = parse(Buffer.concat([pending, chunk]), (args) => {
      const name = args[0]?.toUpperCase();
      if (name === "MULTI") {
        queue = [];
        socket.write(encode(OK));
      } else if (name === "EXEC") {
        const replies = (queue ?? []).map(run);
        queue = null;
        socket.write(encode(replies));
      } else if (name === "DISCARD") {
        queue = null;
        socket.write(encode(OK));
      } else if (queue) {
        queue.push(args);
        socket.write(encode({ status: "QUEUED" }));
      } else {
        socket.write(encode(run(args)));
        if (name === "QUIT") socket.end();
      }
    });
  });
  socket.on("error", () => {});
});

server.listen(port, "127.0.0.1", () => {
  console.log(`local-redis (RESP2 subset) ready on 127.0.0.1:${port}. Ctrl+C to stop.`);
});
