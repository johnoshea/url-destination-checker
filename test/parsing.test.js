import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decodeEntities,
  extractTitle,
  detectCharset,
} from "../src/parsing.js";

test("decodeEntities: named entities", () => {
  assert.equal(decodeEntities("Tom &amp; Jerry"), "Tom & Jerry");
  assert.equal(decodeEntities("&lt;tag&gt;"), "<tag>");
  assert.equal(decodeEntities("she said &quot;hi&quot;"), 'she said "hi"');
  assert.equal(decodeEntities("it&#39;s"), "it's");
  assert.equal(decodeEntities("it&#x27;s"), "it's");
});

test("decodeEntities: numeric decimal entities", () => {
  assert.equal(decodeEntities("&#65;&#66;&#67;"), "ABC");
  assert.equal(decodeEntities("&#8212;"), "—");
});

test("decodeEntities: numeric hex entities", () => {
  assert.equal(decodeEntities("&#x41;&#x42;"), "AB");
  assert.equal(decodeEntities("&#x2014;"), "—");
});

test("decodeEntities: uppercase hex prefix", () => {
  assert.equal(decodeEntities("&#X41;&#X42;"), "AB");
  assert.equal(decodeEntities("&#X2014;"), "—");
});

test("decodeEntities: leaves unknown entities alone", () => {
  assert.equal(decodeEntities("&unknownthing;"), "&unknownthing;");
});

test("decodeEntities: empty and plain strings", () => {
  assert.equal(decodeEntities(""), "");
  assert.equal(decodeEntities("plain text"), "plain text");
});

test("extractTitle: simple title", () => {
  assert.equal(extractTitle("<html><head><title>Hello</title></head>"), "Hello");
});

test("extractTitle: title with attributes", () => {
  assert.equal(
    extractTitle('<title lang="en">My Page</title>'),
    "My Page",
  );
});

test("extractTitle: collapses internal whitespace and trims", () => {
  assert.equal(
    extractTitle("<title>\n  Lots   of\n  space  \n</title>"),
    "Lots of space",
  );
});

test("extractTitle: decodes entities", () => {
  assert.equal(
    extractTitle("<title>Tom &amp; Jerry</title>"),
    "Tom & Jerry",
  );
});

test("extractTitle: returns null when no title tag", () => {
  assert.equal(extractTitle("<html><body>nothing</body></html>"), null);
});

test("extractTitle: returns null for empty title", () => {
  assert.equal(extractTitle("<title></title>"), null);
  assert.equal(extractTitle("<title>   </title>"), null);
});

test("extractTitle: case-insensitive tag matching", () => {
  assert.equal(extractTitle("<TITLE>Caps</TITLE>"), "Caps");
});

test("detectCharset: returns utf-8 when no charset present", () => {
  assert.equal(detectCharset("text/html"), "utf-8");
  assert.equal(detectCharset(""), "utf-8");
  assert.equal(detectCharset(null), "utf-8");
});

test("detectCharset: extracts charset from content-type", () => {
  assert.equal(
    detectCharset("text/html; charset=iso-8859-1"),
    "iso-8859-1",
  );
  assert.equal(
    detectCharset("text/html;charset=Shift_JIS"),
    "shift_jis",
  );
});

test("detectCharset: handles quoted charset values", () => {
  assert.equal(
    detectCharset('text/html; charset="utf-8"'),
    "utf-8",
  );
});
