import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_LADDER,
  availableTiers,
  buildRequest,
  isContextReply,
  decide,
  dispatchMessage,
} from '../scripts/jev-router/core.mjs';

const tiers = availableTiers(MODEL_LADDER.map(({ model }) => model));
const selectedTier = tiers[0];

function response(confidence = 0.9, choice = selectedTier.size) {
  return {
    answers: {
      modelSize: {
        type: 'choice',
        choice,
        confidence,
        probabilities: Object.fromEntries(tiers.map(({ size }) => [size, size === choice ? confidence : 0])),
      },
    },
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}

function assertParent(result) {
  assert.equal(result.action, 'parent');
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
}

test('availableTiers filters unsupported models and deduplicates available models', () => {
  assert.ok(tiers.length >= 2, 'the default ladder must offer multiple distinct models');
  assert.equal(new Set(tiers.map(({ model }) => model)).size, tiers.length);
  assert.deepEqual(availableTiers([]), []);
  assert.deepEqual(availableTiers(['not-a-supported-model']), []);
  const model = tiers[0].model;
  const subset = availableTiers([model, model, 'not-a-supported-model']);
  assert.equal(subset.length, 1);
  assert.equal(subset[0].model, model);
  assert.ok(subset.length < tiers.length);
  assert.deepEqual(availableTiers(tiers.map(({ model }) => model).reverse()), tiers);
});

test('buildRequest carries the message and only one typed model-size question', () => {
  const message = 'What is 17 + 25?';
  const request = buildRequest(message, tiers);
  assert.deepEqual(Object.keys(request).sort(), ['questions', 'state']);
  assert.deepEqual(request.state, { message });
  assert.deepEqual(Object.keys(request.questions), ['modelSize']);
  assert.equal(request.questions.modelSize.type, 'choice');
  assert.equal(typeof request.questions.modelSize.instructions, 'string');
  assert.ok(request.questions.modelSize.instructions.length > 0);
  assert.deepEqual(request.questions.modelSize.criteria,
    Object.fromEntries(tiers.map(({ size, criteria }) => [size, criteria])));
  const restricted = buildRequest(message, tiers.slice(0, 1));
  assert.deepEqual(Object.keys(restricted.questions.modelSize.criteria), [selectedTier.size]);
});

test('context heuristic distinguishes contextual replies from standalone requests', () => {
  assert.equal(isContextReply('yes do that but make it shorter'), true);
  assert.equal(isContextReply('use the second one'), true);
  assert.equal(isContextReply('What is 17 + 25?'), false);
  assert.equal(isContextReply('Write a short email thanking Sam for the update.'), false);
});

test('OFF never invokes Jev', async () => {
  let calls = 0;
  const result = await decide({ message: 'What is 17 + 25?', enabled: false, tiers,
    askJev: async () => { calls++; return response(); } });
  assertParent(result);
  assert.equal(calls, 0);
});

test('contextual replies bypass Jev', async () => {
  for (const message of ['yes do that but make it shorter', 'use the second one']) {
    for (const contextualReply of [false, true]) {
      let calls = 0;
      const result = await decide({ message, enabled: true, tiers, contextualReply,
        askJev: async () => { calls++; return response(); } });
      assertParent(result);
      assert.equal(calls, 0);
    }
  }
});

test('zero or one available model bypasses Jev', async () => {
  for (const available of [[], tiers.slice(0, 1)]) {
    let calls = 0;
    const result = await decide({ message: 'What is 17 + 25?', enabled: true, tiers: available,
      askJev: async () => { calls++; return response(); } });
    assertParent(result);
    assert.equal(calls, 0);
  }
});

test('valid Jev response delegates to the selected available model', async () => {
  const message = 'Write a short email thanking Sam for the update.';
  const jev = response();
  let calls = 0;
  const result = await decide({ message, enabled: true, tiers,
    askJev: async (request, signal) => {
      calls++;
      assert.deepEqual(request, buildRequest(message, tiers));
      assert.ok(signal instanceof AbortSignal);
      assert.equal(signal.aborted, false);
      return jev;
    } });
  assert.equal(calls, 1);
  assert.equal(result.action, 'delegate');
  assert.equal(result.size, selectedTier.size);
  assert.equal(result.model, selectedTier.model);
  assert.equal(result.confidence, 0.9);
  assert.equal(typeof result.reason, 'string');
});

test('confidence below 0.6 falls back and exactly 0.6 delegates', async () => {
  const options = { message: 'What is 17 + 25?', enabled: true, tiers };
  assertParent(await decide({ ...options, askJev: async () => response(0.599) }));
  const boundary = await decide({ ...options, askJev: async () => response(0.6) });
  assert.equal(boundary.action, 'delegate');
  assert.equal(boundary.model, selectedTier.model);
  assert.equal(boundary.confidence, 0.6);
});

test('invalid Jev answers fall back to the parent', async () => {
  const invalid = [
    null,
    {},
    { answers: {} },
    response(0.9, 'unsupported-size'),
    response(undefined),
    response(Number.NaN),
    response(-0.1),
    response(1.1),
    { answers: { modelSize: { type: 'boolean', choice: selectedTier.size, confidence: 0.9 } } },
  ];
  // Omit confidence explicitly; passing undefined to response would use its default.
  delete invalid[4].answers.modelSize.confidence;
  for (const answer of invalid) {
    assertParent(await decide({ message: 'What is 17 + 25?', enabled: true, tiers,
      askJev: async () => answer }));
  }
});

test('network errors fall back to the parent', async () => {
  assertParent(await decide({ message: 'What is 17 + 25?', enabled: true, tiers,
    askJev: async () => { throw new Error('simulated network failure'); } }));
});

test('a hanging Jev call resolves by its deadline and aborts its signal', { timeout: 1500 }, async () => {
  let capturedSignal;
  let aborts = 0;
  const started = performance.now();
  const result = await decide({ message: 'What is 17 + 25?', enabled: true, tiers, timeoutMs: 25,
    askJev: (_request, signal) => {
      capturedSignal = signal;
      signal.addEventListener('abort', () => { aborts++; }, { once: true });
      return new Promise(() => {});
    } });
  assertParent(result);
  assert.ok(performance.now() - started < 1000, 'fallback must not wait for the hanging promise');
  assert.equal(capturedSignal.aborted, true);
  assert.equal(aborts, 1);
});

test('helper failure invokes the original parent handler with the message', async () => {
  const message = 'What is 17 + 25?';
  let parentCalls = 0;
  let deliveredCalls = 0;
  const result = await dispatchMessage({ message, enabled: true, tiers, askJev: async () => response() }, {
    runHelper: async (model, input, size) => {
      assert.equal(model, selectedTier.model);
      assert.equal(input, message);
      assert.equal(size, selectedTier.size);
      throw new Error('simulated helper failure');
    },
    runParent: async (input) => { parentCalls++; assert.equal(input, message); return 'parent answer'; },
    onDelivered: () => { deliveredCalls++; },
  });
  assert.equal(result, 'parent answer');
  assert.equal(parentCalls, 1);
  assert.equal(deliveredCalls, 0);
});

test('helper output receives exactly one footer identifying the actual selected model', async () => {
  for (const helperOutput of ['42', '42\n\nModel used: another-model']) {
    const result = await dispatchMessage({ message: 'What is 17 + 25?', enabled: true, tiers,
      askJev: async () => response() }, {
      runHelper: async () => helperOutput,
      runParent: () => assert.fail('successful helper output must not invoke the parent'),
    });
    assert.equal(result.split('\n').at(-1), `Model used: ${selectedTier.model}`);
    assert.equal(result.match(/^Model used: /gm)?.length, 1);
    assert.equal(result.slice(0, result.lastIndexOf('Model used: ')).trim(), '42');
  }
});

test('bookkeeping errors do not suppress successful helper output', async () => {
  let bookkeepingCalls = 0;
  const result = await dispatchMessage({ message: 'What is 17 + 25?', enabled: true, tiers,
    askJev: async () => response() }, {
    runHelper: async () => '42',
    runParent: () => assert.fail('bookkeeping failure must not invoke the parent'),
    onDelivered: async (decision) => {
      bookkeepingCalls++;
      assert.equal(decision.model, selectedTier.model);
      throw new Error('simulated accounting failure');
    },
  });
  assert.equal(bookkeepingCalls, 1);
  assert.equal(result, `42\n\nModel used: ${selectedTier.model}`);
});
