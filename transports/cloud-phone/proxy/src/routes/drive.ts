import type { FastifyInstance } from "fastify";
import type { Paginated, DriveFile } from "@duoplus/shared";
import { HttpStatusError, type Caller } from "../core.js";

export function registerDriveRoutes(app: FastifyInstance, call: Caller) {
  app.get("/api/drive/files", async (req) => {
    const q = req.query as { keyword?: string; page?: string; pageSize?: string };
    const page = Number(q.page ?? "1");
    const pageSize = Number(q.pageSize ?? "20");
    const body: { keyword?: string; page: number; pagesize: number } = { page, pagesize: pageSize };
    if (q.keyword) body.keyword = q.keyword;
    const data = await call<{ list: DriveFile[]; total: number }>("/api/v1/cloudDisk/list", body);
    const out: Paginated<DriveFile> = { items: data.list, page, pageSize, total: data.total };
    return out;
  });

  app.post("/api/drive/push", async (req) => {
    const body = req.body as { ids: string[]; image_ids: string[]; dest_dir: string };
    return call("/api/v1/cloudDisk/pushFiles", body);
  });

  app.post("/api/drive/delete", async (req) => {
    const body = req.body as { ids: string[] };
    return call("/api/v1/cloudDisk/delFiles", body);
  });

  // Mints an Alibaba OSS signed PUT URL. NOTE: this only mints the URL; the
  // actual file bytes must be PUT to the returned signedUrl (with the returned
  // headers). The /api/drive/upload route below performs that PUT server-side.
  app.post("/api/drive/upload-url", async (req) => {
    const body = req.body as { name: string; is_app?: number; pkg?: string };
    return call("/api/v1/cloudDisk/signedUrl", body);
  });

  // Receives a browser multipart file upload, mints the OSS signed URL, then
  // performs the OSS PUT server-side (avoids browser CORS). Returns the stored
  // file name + original name on success.
  app.post("/api/drive/upload", async (req, reply) => {
    const file = await req.file();
    if (!file) return reply.status(400).send({ error: "no file uploaded" });
    const buffer = await file.toBuffer();
    const filename = file.filename;

    const signed = await call<SignedUrlResult>("/api/v1/cloudDisk/signedUrl", { name: filename });

    const ossHeaders: Record<string, string> = {};
    const cb = signed.headers?.["x-oss-callback"];
    const cbVar = signed.headers?.["x-oss-callback-var"];
    if (cb) ossHeaders["x-oss-callback"] = cb;
    if (cbVar) ossHeaders["x-oss-callback-var"] = cbVar;

    const put = await fetch(signed.signedUrl, { method: "PUT", headers: ossHeaders, body: new Uint8Array(buffer) });
    if (!put.ok) {
      let text = "";
      try { text = await put.text(); } catch { /* ignore */ }
      throw new HttpStatusError(put.status, text);
    }

    return { name: signed.name, original_file_name: signed.original_file_name };
  });
}

interface SignedUrlResult {
  method: string;
  signedUrl: string;
  headers: Record<string, string>;
  name: string;
  original_file_name: string;
}
