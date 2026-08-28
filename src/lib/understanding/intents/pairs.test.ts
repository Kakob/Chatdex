import { describe, it, expect } from 'vitest';
import {
  selectIntentPairs,
  looksPasted,
  endsWithQuestionOrOptions,
  DEFAULT_MAX_PROMPT_CHARS,
  DEFAULT_MAX_REPLY_CHARS,
} from './pairs';
import type { StoredMessage, ContentBlock } from '../../../types';

let clock = 0;
function msg(
  sender: StoredMessage['sender'],
  text: string,
  overrides: Partial<StoredMessage> = {}
): StoredMessage {
  clock += 1000;
  return {
    id: `m-${clock}`,
    conversationId: 'conv-1',
    sender,
    text,
    createdAt: new Date(1_700_000_000_000 + clock),
    ...overrides,
  };
}

describe('selectIntentPairs — plain (claude.ai-style) conversations', () => {
  const messages = [
    msg('user', 'Build me a sidebar badge for pending reviews.'),
    msg('assistant', 'Sure. Should the badge show the total count, or only counts over zero?'),
    msg('user', 'Only over zero, and I want it amber.'),
    msg('assistant', 'Done. Anything else?'),
    msg('user', 'No, that is it.'),
  ];

  it('yields one pair per user message with correct indexes', () => {
    const pairs = selectIntentPairs('conv-1', messages);
    expect(pairs.map((p) => [p.promptI, p.replyI])).toEqual([
      [null, 0],
      [1, 2],
      [3, 4],
    ]);
  });

  it('marks the opening message as unprompted (promptI null) and carries prompt text otherwise', () => {
    const [opening, second] = selectIntentPairs('conv-1', messages);
    expect(opening.promptI).toBeNull();
    expect(opening.promptText).toBe('');
    expect(opening.promptedByQuestion).toBe(false);
    expect(second.promptText).toContain('only counts over zero?');
    expect(second.promptedByQuestion).toBe(true);
    expect(second.replyText).toBe('Only over zero, and I want it amber.');
  });

  it('carries the previous user message as context', () => {
    const [, second, third] = selectIntentPairs('conv-1', messages);
    expect(second.priorUserText).toBe('Build me a sidebar badge for pending reviews.');
    expect(third.priorUserText).toBe('Only over zero, and I want it amber.');
  });

  it('is deterministic', () => {
    expect(selectIntentPairs('conv-1', messages)).toEqual(selectIntentPairs('conv-1', messages));
  });

  it('treats a second consecutive user message as unprompted', () => {
    const consecutive = [
      msg('user', 'Add a badge.'),
      msg('assistant', 'Where should it go?'),
      msg('user', 'Sidebar.'),
      msg('user', 'Also, never auto-accept anything.'),
    ];
    const pairs = selectIntentPairs('conv-1', consecutive);
    expect(pairs.map((p) => p.promptI)).toEqual([null, 1, null]);
  });

  it('ignores system messages for pairing but keeps full-list indexes', () => {
    const withSystem = [
      msg('system', 'You are helpful.'),
      msg('user', 'I want dark mode by default.'),
      msg('assistant', 'Should it follow the OS setting?'),
      msg('user', 'Yes.'),
    ];
    const pairs = selectIntentPairs('conv-1', withSystem);
    expect(pairs.map((p) => [p.promptI, p.replyI])).toEqual([
      [null, 1],
      [2, 3],
    ]);
  });
});

describe('selectIntentPairs — Claude Code conversations with tool blocks', () => {
  function blocks(...items: ContentBlock[]): ContentBlock[] {
    return items;
  }

  it('skips tool calls/results between assistant text and the user reply, merging split assistant text', () => {
    const assistant = msg('assistant', '[Tool: Read]', {
      contentBlocks: blocks(
        { type: 'text', text: 'Let me look at the layout first.' },
        { type: 'tool_use', toolName: 'Read', toolInput: { file_path: 'src/Sidebar.tsx' }, toolUseId: 't1' },
        { type: 'text', text: 'I can add the badge next to the Projects link. Amber or violet?' }
      ),
    });
    const toolResult = msg('user', '[Tool Result: Read]', {
      contentBlocks: blocks({ type: 'tool_result', toolName: 'Read', toolResult: 'export function Sidebar()…', toolUseId: 't1' }),
    });
    const messages = [
      msg('user', 'Put a pending-review badge in the sidebar.'),
      assistant,
      toolResult,
      msg('user', 'Amber. And I do not want it to show zero.'),
    ];
    const pairs = selectIntentPairs('conv-1', messages);
    expect(pairs).toHaveLength(2);
    const reply = pairs[1];
    expect(reply.replyI).toBe(3);
    expect(reply.promptI).toBe(1);
    expect(reply.promptText).toBe(
      'Let me look at the layout first.\nI can add the badge next to the Projects link. Amber or violet?'
    );
    expect(reply.promptedByQuestion).toBe(true);
  });

  it('does not produce a pair from a tool_result-only user message', () => {
    const messages = [
      msg('user', 'Run the tests.'),
      msg('assistant', '[Tool: Bash]', {
        contentBlocks: blocks({ type: 'tool_use', toolName: 'Bash', toolInput: { command: 'npm test' }, toolUseId: 't2' }),
      }),
      msg('user', '[Tool Result: Bash]', {
        contentBlocks: blocks({ type: 'tool_result', toolName: 'Bash', toolResult: '664 passed', toolUseId: 't2' }),
      }),
    ];
    const pairs = selectIntentPairs('conv-1', messages);
    expect(pairs.map((p) => p.replyI)).toEqual([0]);
  });
});

describe('selectIntentPairs — pasted material and limits', () => {
  it('skips a pasted stack trace but still uses the earlier user message as context', () => {
    const trace = [
      'TypeError: Cannot read properties of undefined',
      '    at Sidebar (src/Sidebar.tsx:40:12)',
      '    at renderWithHooks (react-dom.development.js:1)',
      '    at mountIndeterminateComponent (react-dom.development.js:2)',
      '    at beginWork (react-dom.development.js:3)',
    ].join('\n');
    const messages = [
      msg('user', 'I want the badge to survive reloads.'),
      msg('assistant', 'Try it now?'),
      msg('user', trace),
      msg('assistant', 'Fixed the null check. Good?'),
      msg('user', 'Yes, but keep the count amber.'),
    ];
    const pairs = selectIntentPairs('conv-1', messages);
    expect(pairs.map((p) => p.replyI)).toEqual([0, 4]);
    expect(pairs[1].priorUserText).toBe('I want the badge to survive reloads.');
  });

  it('truncates prompt from the tail and reply from the head', () => {
    const longPrompt = `${'x'.repeat(2000)} Do you want option A or option B?`;
    const longReply = `Option B because ${'y'.repeat(2000)}`;
    const messages = [msg('assistant', longPrompt), msg('user', longReply)];
    const [pair] = selectIntentPairs('conv-1', messages);
    expect(pair.promptText.length).toBe(DEFAULT_MAX_PROMPT_CHARS);
    expect(pair.promptText.endsWith('option A or option B?')).toBe(true);
    expect(pair.replyText.length).toBe(DEFAULT_MAX_REPLY_CHARS);
    expect(pair.replyText.startsWith('Option B because')).toBe(true);
  });

  it('keeps only the most recent pairs when over the per-conversation cap', () => {
    const messages: StoredMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(msg('assistant', `Question ${i}?`));
      messages.push(msg('user', `Answer ${i}`));
    }
    const pairs = selectIntentPairs('conv-1', messages, { maxPairsPerConversation: 3 });
    expect(pairs.map((p) => p.replyText)).toEqual(['Answer 7', 'Answer 8', 'Answer 9']);
  });
});

describe('looksPasted', () => {
  it('flags JSON / log blocks and very long text without first-person verbs', () => {
    expect(looksPasted('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}')).toBe(true);
    expect(looksPasted('lorem ipsum '.repeat(400))).toBe(true);
  });
  it('keeps the user’s own words, even long ones', () => {
    expect(looksPasted('no, I want the badge amber')).toBe(false);
    expect(looksPasted(`I think ${'this matters '.repeat(400)}`)).toBe(false);
  });
});

describe('endsWithQuestionOrOptions', () => {
  it('detects trailing questions, markdown-wrapped questions, and option lists', () => {
    expect(endsWithQuestionOrOptions('Amber or violet?')).toBe(true);
    expect(endsWithQuestionOrOptions('**Which one?**')).toBe(true);
    expect(endsWithQuestionOrOptions('Pick one:\n1. Amber\n2. Violet')).toBe(true);
    expect(endsWithQuestionOrOptions('Done. I added the badge.')).toBe(false);
  });
});
