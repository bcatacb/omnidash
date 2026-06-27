import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listDriveFiles, pushFiles, deleteFiles, mintUploadUrl, uploadFile, type SignedUrlResult,
} from "../../api/drive";

const DEFAULT_DEST = "/sdcard/Download";

function parseIds(raw: string): string[] {
  return raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

export function DrivePage() {
  const qc = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const driveKey = ["drive", keyword] as const;
  const { data, isLoading, isError } = useQuery({
    queryKey: driveKey,
    queryFn: () => listDriveFiles({ keyword: keyword || undefined, page: 1, pageSize: 50 }),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["drive"] });
  const [result, setResult] = useState<string | null>(null);

  const [fileIds, setFileIds] = useState("");
  const [phoneIds, setPhoneIds] = useState("");
  const [destDir, setDestDir] = useState(DEFAULT_DEST);

  const push = useMutation({
    mutationFn: () => pushFiles({ ids: parseIds(fileIds), image_ids: parseIds(phoneIds), dest_dir: destDir }),
    onSuccess: (r) => setResult(`Push: ${r.message}`),
    onError: (e) => setResult(`Push failed: ${(e as Error).message}`),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteFiles([id]),
    onSuccess: (r) => { setResult(`Delete: ${r.message}`); invalidate(); },
  });

  const [uploadName, setUploadName] = useState("");
  const [signed, setSigned] = useState<SignedUrlResult | null>(null);
  const upload = useMutation({
    mutationFn: () => mintUploadUrl({ name: uploadName }),
    onSuccess: (r) => { setSigned(r); setResult("Signed URL minted"); },
  });

  const [file, setFile] = useState<File | null>(null);
  const fileUpload = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("no file selected");
      return uploadFile(file);
    },
    onSuccess: (r) => { setResult(`Uploaded ${r.original_file_name}`); setFile(null); invalidate(); },
    onError: (e) => setResult(`Upload failed: ${(e as Error).message}`),
  });

  const pushDisabled = parseIds(fileIds).length === 0 || parseIds(phoneIds).length === 0 || !destDir || push.isPending;

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-xl font-semibold text-fg">Cloud Drive</h1>

      <div className="flex items-end gap-2">
        <label className="flex flex-col text-xs text-fg-muted">Search
          <input className="input mt-1" value={keyword}
            onChange={(e) => setKeyword(e.target.value)} placeholder="keyword" aria-label="search files" />
        </label>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); push.mutate(); }}
        className="card p-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-fg-muted">File ids
          <input className="input mt-1" value={fileIds}
            onChange={(e) => setFileIds(e.target.value)} placeholder="file-1, file-2" aria-label="push file ids" />
        </label>
        <label className="flex flex-col text-xs text-fg-muted">Target phone ids
          <input className="input mt-1" value={phoneIds}
            onChange={(e) => setPhoneIds(e.target.value)} placeholder="cp-1, cp-2" aria-label="push phone ids" />
        </label>
        <label className="flex flex-col text-xs text-fg-muted">Destination
          <input className="input mt-1" value={destDir}
            onChange={(e) => setDestDir(e.target.value)} aria-label="dest dir" />
        </label>
        <button type="submit" className="btn btn-blue"
          disabled={pushDisabled}>Push files</button>
      </form>

      <form onSubmit={(e) => { e.preventDefault(); if (file) fileUpload.mutate(); }}
        className="card p-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-fg-muted">Upload a file
          <input type="file" className="text-sm text-fg-muted" aria-label="upload file bytes"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <button type="submit" className="btn btn-green"
          disabled={!file || fileUpload.isPending}>Upload</button>
      </form>

      <form onSubmit={(e) => { e.preventDefault(); if (uploadName) upload.mutate(); }}
        className="card p-4 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-xs text-fg-muted">Upload file name (with ext)
          <input className="input mt-1" value={uploadName}
            onChange={(e) => setUploadName(e.target.value)} placeholder="clip.mp4" aria-label="upload name" />
        </label>
        <button type="submit" className="btn btn-cyan"
          disabled={!uploadName || upload.isPending}>Get upload URL</button>
      </form>

      {signed && (
        <div className="card p-3 text-xs space-y-1">
          <p className="font-semibold">Signed URL ({signed.method}):</p>
          <p className="font-mono break-all">{signed.signedUrl}</p>
          <p className="text-fg-muted">Note: the browser-side PUT of the file bytes to Alibaba OSS is a follow-up; this only mints the URL.</p>
        </div>
      )}

      {result && <p className="text-sm text-fg-muted">{result}</p>}

      {isLoading && <p className="text-fg-muted">Loading files…</p>}
      {isError && <p className="text-neon-red">Failed to load files.</p>}

      {data && (
        <table className="table card">
          <thead>
            <tr><th className="p-2">Id</th><th className="p-2">Name</th><th className="p-2">Original name</th><th className="p-2">Actions</th></tr>
          </thead>
          <tbody>
            {data.items.map((f) => (
              <tr key={f.id}>
                <td className="p-2 font-mono text-xs">{f.id}</td>
                <td className="p-2">{f.name}</td>
                <td className="p-2">{f.original_file_name}</td>
                <td className="p-2">
                  <button className="text-neon-red disabled:opacity-40" disabled={del.isPending}
                    onClick={() => del.mutate(f.id)} aria-label={`delete ${f.id}`}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
