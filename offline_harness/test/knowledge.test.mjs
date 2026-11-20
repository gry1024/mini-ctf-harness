import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadCatalog} from '../src/knowledge/catalog.mjs';
import {knowledgeTool, askReference} from '../src/knowledge/reader.mjs';
import {metrics} from '../src/rag/evaluate.mjs';

const lookup = loadCatalog();
const fixtures = {
  'languages/php/assert-string': ['zend.assertions', 'Does PHP 7.2 still evaluate string assertions', 'string assertion'],
  'languages/php/number-string-comparison': ['==', 'PHP 8 comparing a non-numeric string with 0', 'non-numeric string'],
  'languages/php/numeric-trailing-space': ['is_numeric', 'whitespace after a numeric string', 'trailing whitespace'],
  'formats/elf/nobits': ['SHT_NOBITS', 'section size in memory versus on disk', 'sh_offset'],
  'formats/png/chunk-length': ['chunk length', 'Does the PNG chunk length include the chunk type', 'IEND byte length'],
  'formats/png/crc-coverage': ['CRC32', 'Does the checksum include the chunk type', 'PNG checksum']
};

test('symbol and descriptive queries rank known cards; negatives abstain', t => {
  let recall = 0, mrr = 0, count = 0;
  for (const [id, queries] of Object.entries(fixtures)) {
    for (const query of queries) {
      const {results} = lookup({op: 'search', query});
      const ranking = results.map(row => row.id);
      const metric = metrics(ranking, {[id]: 1}, 3);
      if (query === queries[0]) assert.equal(ranking[0], id, query);
      assert.equal(metric.recall, 1, query);
      recall += metric.recall; mrr += metric.mrr; count++;
      for (const row of results) assert.deepEqual(Object.keys(row).sort(), ['applies', 'id', 'summary', 'title']);
    }
  }
  t.diagnostic(JSON.stringify({queries: count, recallAt3: recall/count, mrrAt3: mrr/count}));
  for (const query of ['QUIC', 'PHP fibers', 'PNG acTL', '']) {
    if (query === '') assert.throws(() => lookup({op: 'search', query}));
    else assert.deepEqual(lookup({op: 'search', query}), {results: []}, query);
  }
  assert.deepEqual(lookup({op: 'search', query: 'assert', scope: 'formats'}), {results: []});
  assert.deepEqual(lookup({op: 'search', query: 'SHT_NOBITS', tag: 'web'}), {results: []});
  assert.equal(lookup({op: 'search', query: 'SHT_NOBITS', tag: 'reverse'}).results[0].id, 'formats/elf/nobits');
});

test('browse is paginated; details require a single registered id', () => {
  const list = scope => {
    const entries = [];
    let offset = 0;
    do {
      const page = lookup({op: 'browse', scope, offset, limit: 1});
      assert.equal(page.entries.length, 1);
      entries.push(...page.entries);
      assert.ok(page.nextOffset === null || page.nextOffset === offset + 1);
      offset = page.nextOffset;
    } while (offset !== null);
    return entries;
  };
  const walk = scope => list(scope).flatMap(entry => {
    if (entry.id) return [entry];
    const children = walk(entry.scope);
    assert.equal(entry.count, children.length, entry.scope);
    return children;
  });
  const rows = walk('');
  const queries = JSON.parse(readFileSync(new URL('./fixtures/knowledge-queries.json', import.meta.url)));
  assert.deepEqual(rows.map(r => r.id).sort(), Object.keys(queries).sort());
  for (const {id} of rows) {
    const card = lookup({op: 'get', id});
    assert.ok(card.detail && card.boundary && card.sources.reference && card.sources.context);
    assert.ok(!JSON.stringify(knowledgeTool).includes(id));
    const hits = lookup({op: 'search', query: queries[id]}).results;
    assert.ok(hits.some(r => r.id === id), queries[id]);
  }
  for (const args of [{op: 'get', id: '../README.md'}, {op: 'get', id: '*'}, {op: 'get', id: rows.map(r => r.id)},
    {op: 'browse', scope: 'unknown'}, {op: 'browse', offset: -1}, {op: 'search', query: 'a', limit: 6},
    {op: 'get', id: rows[0].id, includeAll: true}]) assert.throws(() => lookup(args));
});

test('additional paraphrases retrieve the intended reference in the first three', () => {
  const queries = JSON.parse(readFileSync(new URL('./fixtures/knowledge-paraphrases.json', import.meta.url)));
  for (const [id, query] of Object.entries(queries)) {
    assert.ok(lookup({op: 'search', query}).results.some(card => card.id === id), query);
  }
});

test('contest topic queries and browse filters work across all five categories', () => {
  const topics = JSON.parse(readFileSync(new URL('./fixtures/knowledge-contest-topics.json', import.meta.url)));
  const walk = (scope, tag) => {
    let offset = 0;
    const result = [];
    do {
      const page = lookup({op: 'browse', tag, scope, offset});
      for (const entry of page.entries) {
        if (entry.id) result.push(entry.id);
        else {
          const nested = walk(entry.scope, tag);
          assert.ok(nested.length > 0);
          assert.equal(nested.length, entry.count);
          result.push(...nested);
        }
      }
      offset = page.nextOffset;
    } while (offset !== null);
    return result;
  };
  for (const tag of ['web', 'reverse', 'pwn', 'crypto', 'misc']) {
    const ids = walk('', tag);
    const subset = topics.filter(([category]) => category === tag);
    assert.equal(subset.length, 2);
    for (const [, query, id] of subset) {
      assert.ok(ids.includes(id));
      for (const params of [{op: 'search', query}, {op: 'search', query, tag}]) {
        assert.ok(lookup(params).results.some(hit => hit.id === id), query);
      }
    }
    if (tag === 'pwn') assert.ok(!ids.includes('formats/audio/dtmf-grid'));
  }
});

test('repository launcher resolves the catalog outside the working directory', () => {
  const cmd = fileURLToPath(new URL('../../mini-ctf', import.meta.url));
  const result = spawnSync(cmd, ['knowledge', 'search', 'CRC32', '--limit', '1'], {cwd: '/', encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).results[0].id, 'formats/png/crc-coverage');
});

test('loopback model protocol exposes only the lookup tool, and expands one card on demand', async t => {
  const seen = [];
  const id = 'formats/png/crc-coverage';
  const queries = [{op: 'search', query: 'CRC32', limit: 1}, {op: 'get', id}];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    seen.push(JSON.parse(raw));
    const n = seen.length - 1;
    const message = n < queries.length ? {role: 'assistant', content: null, tool_calls: [{
      id: 'lookup-' + n, type: 'function', function: {name: 'knowledge', arguments: JSON.stringify(queries[n])}
    }]} : {role: 'assistant', content: id};
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({choices: [{message}]}));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
  const answer = await askReference({baseUrl, model: 'protocol-fixture', question: 'PNG checksum coverage', lookup});
  assert.equal(answer, id);
  assert.deepEqual(seen[0].tools, [knowledgeTool]);
  assert.ok(!JSON.stringify(seen[0]).includes(id));
  const summary = seen[1].messages.at(-1), detail = seen[2].messages.at(-1);
  assert.equal(summary.tool_call_id, 'lookup-0');
  assert.deepEqual(Object.keys(JSON.parse(summary.content).results[0]).sort(), ['applies','id','summary','title']);
  assert.equal(JSON.parse(detail.content).id, id);
  assert.ok(JSON.parse(detail.content).sources.reference);
  t.diagnostic(JSON.stringify({toolSchemaBytes: Buffer.byteLength(JSON.stringify(knowledgeTool)),
    searchResultBytes: Buffer.byteLength(summary.content), cardBytes: Buffer.byteLength(detail.content)}));
});

test('text-only servers receive one bounded excerpt and return its verifiable card ID', async t => {
  let body;
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const part of req) raw += part;
    body = JSON.parse(raw);
    res.end(JSON.stringify({choices: [{message: {role: 'assistant', content: 'Local answer'}}]}));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const options = {model: 'text-only-fixture', baseUrl: 'http://127.0.0.1:' + server.address().port + '/v1', lookup, textOnly: true};
  assert.equal(await askReference({...options, question: 'QUIC'}), 'No matching knowledge cards.');
  assert.equal(body, undefined);
  const answer = await askReference({...options, question: 'Two concatenated gz members, decompression only returns the first'});
  assert.match(answer, /^Retrieved excerpt \[formats\/gzip\/members\]/);
  assert.match(answer, /Model answer Local answer$/);
  assert.ok(!('tools' in body));
  const prompt = body.messages[1].content;
  const card = lookup({op: 'get', id: 'formats/gzip/members'});
  assert.ok(prompt.includes(card.summary) && prompt.includes(card.id));
  assert.ok(!prompt.includes(card.sources.reference));
  assert.ok(!prompt.includes('formats/gzip/trailer'));
});
