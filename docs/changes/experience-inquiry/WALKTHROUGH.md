# Research inquiry: getting started

## What is in the bundle

The original [CODEX_HANDOFF_CHATDEX_INQUIRY.md](CODEX_HANDOFF_CHATDEX_INQUIRY.md)
is preserved here verbatim. It describes intended behavior, not a claim that every
acceptance check has passed; see [PLAN.md](PLAN.md) for delivery status.

The companion `mit_research_sources.private.json` is a private source inventory,
not source content. It contains 11 source leads. The exact supplied JSON is saved locally at:

```
research-data/mit/mit_research_sources.private.json
```

This directory and `*.private.json` are ignored by Git. Do not copy the JSON into
tracked docs or fixtures: it contains private locators and research notes. A fresh
clone will not include it. Keep your own private backup of the original bundle.
No private source links are reproduced in these instructions.

## Open the actual workflow

1. Run `npm run dev`, then open `http://localhost:4000/projects`.
2. Click **Open / create MIT Investigations**. This creates an empty project, not
   imported evidence. In any project, **Research sources & questions** in the
   header opens the same research shelf. Investigate History also links to it.
3. Under **Private registry leads**, choose the JSON above. Review the titles and
   date claims, then click **Register … leads locally**. Every entry remains
   **reference-only / import needed**. No URLs are visited.
4. Use the editable suggested question and click **Start investigation · no
   conversation required**. Check the sources you want attached to the case.

The inventory can be registered repeatedly without duplicating its stable IDs.
Saving a file in the checkout does not automatically import it into browser storage.
Use the same browser and origin consistently: `localhost` and `127.0.0.1` have
separate IndexedDB data. The MIT imports are in the user’s Chrome at `http://localhost:4000`.

## Supply actual source exports

| Source lead category from the handoff | What is available now | What to provide |
| --- | --- | --- |
| Spring 2019 research paper | Imported local text snapshot | Use Read imported text on the source shelf |
| October 2026 draft/script | Imported local text snapshot | Use Read imported text on the source shelf |
| May 2017 proposal | Imported local text snapshot | Use Read imported text on the source shelf |
| ChatGPT research conversations | Registry lead only | ChatGPT ZIP or JSON export through the existing Import page |
| Academic-support and planning correspondence | Registry leads only | User-selected text exports; retain author, original date, and thread locator |
| Event video | Registry lead only | Keep a reference with timestamps; optionally provide a separately attributed transcript |
| Other recollections | No content supplied | Add explicitly as recollections, with authored and described-event dates kept separate |

The bundle contains **no primary-source document or conversation exports**. Its
summaries and dates are leads, not verified statements about the source contents.
After explicit read-only authorization, all three linked Google Docs were exported
and imported locally. Google originals were not modified. Other accounts and source
categories were not fetched.
PDF and EML imports are not implemented: convert to text and record conversion or
transcription uncertainty. Video URLs are not downloaded or transcribed.

## Read, pin, revise, and trace a question

1. On the shelf select an existing lead under **Import into**. Choose a `.txt` or
   `.md` export, inspect the preview, and **Confirm local import**. Use the same
   source for later versions; identical text is deduplicated within that source.
   If the native picker fails, expand **Paste text instead**, enter an export filename
   and text, then **Preview pasted text** and confirm. Clipboard line endings may
   normalize; the original file export remains unchanged.
   Click **Read sources** at the top, then **Read imported text** on a source card
   to read its full text directly, without a case. **Stored version** selects older
   snapshots. The project header counts conversation sources separately.
2. For conversations, import through **Import**, accept the conversation in the
   project overview, then **Add to shelf** under Accepted project conversations.
3. Open the case and attach the sources. Search is literal and limited to attached
   imported snapshots, including older versions; reference-only content is excluded.
4. In Source reader, select a source/version, highlight text, and **Pin exact
   selection**. For conversations select within one message, excluding its heading.
   The evidence board records speaker, expression date, note, and integrity state.
5. **Inspect exact original** returns to the pinned snapshot, even after a changed
   file is imported. Missing or corrupted source material stays explicitly unavailable
   or mismatched. A reference can only produce an unverified locator note.
6. Write a finding, select supporting and conflicting exhibits, and save. Finalize
   explicitly. **Reopen / revise finding** retains prior wording and evidence. A
   completed case must be reopened before editing findings.
7. Pin the exact wording of two historical questions and choose **Use exact wording
   as question formulation**. Compare them in Question lineage, inspect both originals,
   choose a relation, and write your explanation. Keep it tentative if uncertain.
   To correct a link, remove it with a reason and add the corrected relation; the
   history retains both actions. No personal lineage is supplied automatically.
8. Build a **Private research packet** preview. Default JSON/Markdown includes quotes,
   metadata, locators, findings and revision history; source bodies and URLs are
   omitted. Quotes and human notes can still be private. Review before downloading.

## Synthetic demonstration

**Open synthetic walkthrough** creates a separate **SYNTHETIC — Fern Harbor inquiry**
project, using fabricated people, two documents and a ChatGPT-format export. It
includes excerpts, a later recollection with unknown authored date, a reference-only
interview lead, two question formulations, a tentative example relation, and a draft
finding with support and conflict. These are demonstration records, not MIT evidence.

The live browser check created this sample, opened an original excerpt, pinned a new
selection from a CRLF document, compared 2019 and 2026 formulations, and saved a human
finding revision while retaining its earlier version. Backend integrity tests cover
changed versions, invalid offsets/hashes, missing sources and cross-project rejection.

## Storage and limits

- Dexie v14 adds four tables; no existing stores or records are replaced.
- Research registry, snapshots, exhibits and relation history stay on this device.
  Existing case/finding/question records retain the existing encrypted-sync behavior.
  Another device does not automatically receive the local research evidence.
- Text snapshots preserve imported text and a SHA-256 hash; conversation snapshots
  use existing normalized events and retain per-message role/date locators.
- No AI processing is required or invoked by the research workflow.
- Export is inspectable; automatic packet restoration is not implemented.
- The original handoff's complete acceptance checklist remains the delivery target;
  see the plan for outstanding checks rather than treating this guide as a completion claim.
