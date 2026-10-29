import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  StoreConflictError,
  createFileStore,
  updateDocument,
  workspaceKey
} from "../scripts/lib/store.mjs";

async function withStore(run) {
  const directory = await mkdtemp(join(tmpdir(), "court-scout-store-"));
  try {
    await run(createFileStore(directory), directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("documents keep today's file layout and report a stable ETag", async () => {
  await withStore(async (store, directory) => {
    assert.equal(await store.read("team-roles.json"), null);
    const etag = await store.write("jobs/abc.json", { status: "running" });
    assert.deepEqual(
      JSON.parse(await readFile(join(directory, "jobs", "abc.json"), "utf8")),
      { status: "running" }
    );
    const read = await store.read("jobs/abc.json");
    assert.deepEqual(read.value, { status: "running" });
    assert.equal(read.etag, etag);
    assert.deepEqual(await store.list("jobs"), ["jobs/abc.json"]);
    assert.deepEqual(await store.list("missing"), []);
  });
});

test("conditional writes refuse a stale or unexpected document", async () => {
  await withStore(async store => {
    const first = await store.write("doc.json", { n: 1 }, { ifMatch: null });
    await assert.rejects(
      store.write("doc.json", { n: 2 }, { ifMatch: null }),
      StoreConflictError
    );
    const second = await store.write("doc.json", { n: 2 }, { ifMatch: first });
    await assert.rejects(
      store.write("doc.json", { n: 3 }, { ifMatch: first }),
      StoreConflictError
    );
    await assert.rejects(store.delete("doc.json", { ifMatch: first }), StoreConflictError);
    await store.delete("doc.json", { ifMatch: second });
    assert.equal(await store.read("doc.json"), null);
  });
});

test("updates retry against a concurrent writer and never lose a change", async () => {
  await withStore(async store => {
    await Promise.all(Array.from({ length: 5 }, (_, index) =>
      updateDocument(store, "counter.json", value => ({
        seen: [...value.seen, index]
      }), { initial: () => ({ seen: [] }), attempts: 10 })
    ));
    const { value } = await store.read("counter.json");
    assert.deepEqual([...value.seen].sort(), [0, 1, 2, 3, 4]);
  });
});

test("keys cannot leave the data folder", async () => {
  await withStore(async store => {
    for (const key of ["../outside.json", "/etc/passwd", "a/../../b.json", "a\\b.json", ""]) {
      await assert.rejects(store.write(key, {}), /Invalid store key/);
    }
  });
});

test("only the default workspace keeps top-level file names", () => {
  assert.equal(workspaceKey("default", "match-cards.json"), "match-cards.json");
  assert.equal(
    workspaceKey("tong-2027", "match-cards.json"),
    "workspaces/tong-2027/match-cards.json"
  );
  assert.throws(() => workspaceKey("../x", "a.json"), /Invalid store key/);
});
