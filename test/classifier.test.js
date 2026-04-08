import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/classifier.js";

const PAGE_ORIGIN = "https://news.ycombinator.com";

test("classify: known shortener returns shortener kind", () => {
  assert.deepEqual(classify("https://bit.ly/abc123", PAGE_ORIGIN), {
    kind: "shortener",
  });
  assert.deepEqual(classify("https://t.co/xyz", PAGE_ORIGIN), {
    kind: "shortener",
  });
});

test("classify: shortener on same origin is ignored", () => {
  assert.deepEqual(classify("https://bit.ly/abc", "https://bit.ly"), {
    kind: "ignore",
  });
});

test("classify: unknown host is ignored", () => {
  assert.deepEqual(
    classify("https://example.com/some-page", PAGE_ORIGIN),
    { kind: "ignore" },
  );
});

test("classify: empty / non-http hrefs are ignored", () => {
  assert.deepEqual(classify("", PAGE_ORIGIN), { kind: "ignore" });
  assert.deepEqual(classify("javascript:void(0)", PAGE_ORIGIN), {
    kind: "ignore",
  });
  assert.deepEqual(classify("mailto:foo@bar.com", PAGE_ORIGIN), {
    kind: "ignore",
  });
  assert.deepEqual(classify("tel:+15551234", PAGE_ORIGIN), {
    kind: "ignore",
  });
  assert.deepEqual(classify("#section", PAGE_ORIGIN), { kind: "ignore" });
});

test("classify: malformed URL is ignored", () => {
  assert.deepEqual(classify("not a url", PAGE_ORIGIN), { kind: "ignore" });
});

test("classify: youtu.be short link", () => {
  assert.deepEqual(
    classify("https://youtu.be/dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: youtube.com/watch", () => {
  assert.deepEqual(
    classify("https://www.youtube.com/watch?v=dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: youtube.com/watch with extra params", () => {
  assert.deepEqual(
    classify(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=foo",
      PAGE_ORIGIN,
    ),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: youtube.com/shorts", () => {
  assert.deepEqual(
    classify("https://www.youtube.com/shorts/dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: youtube.com/live", () => {
  assert.deepEqual(
    classify("https://www.youtube.com/live/dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: youtube.com/embed", () => {
  assert.deepEqual(
    classify("https://www.youtube.com/embed/dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: m.youtube.com and music.youtube.com", () => {
  assert.deepEqual(
    classify("https://m.youtube.com/watch?v=dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
  assert.deepEqual(
    classify("https://music.youtube.com/watch?v=dQw4w9WgXcQ", PAGE_ORIGIN),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: youtube link is classified even on youtube.com origin", () => {
  assert.deepEqual(
    classify(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com",
    ),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});

test("classify: invalid youtube video id is ignored", () => {
  assert.deepEqual(
    classify("https://youtu.be/short", PAGE_ORIGIN),
    { kind: "ignore" },
  );
});

test("classify: youtube /shorts with 12-char segment is ignored", () => {
  // Regression: previously the regex captured only the first 11 chars,
  // truncating a 12-char ID into a "valid" lookup.
  assert.deepEqual(
    classify("https://www.youtube.com/shorts/dQw4w9WgXcQEXTRA", "https://example.com"),
    { kind: "ignore" },
  );
});

test("classify: youtube /shorts with trailing slash still classifies", () => {
  assert.deepEqual(
    classify("https://www.youtube.com/shorts/dQw4w9WgXcQ/", "https://example.com"),
    { kind: "youtube", videoId: "dQw4w9WgXcQ" },
  );
});
