# Research Atlas MVP

**Status:** Feature branch (not deployed)
**Built:** October 23, 2026
**Local URL:** http://localhost:4000/research

## Purpose

Research Atlas is a local-first directory of U.S.-affiliated researchers, research projects and publications, with source links and an investigation notebook for independently reproducible contributions. It does not change your existing Chatdex conversations or knowledge system.

## Run

From Chatdex repository root:

    npm ci
    npm run dev

Open http://localhost:4000/research. No backend or Postgres is needed for the starter data.

For local verification:

    npm run typecheck
    npm run test -- src/features/researchAtlas/openalex.test.ts
    npm run build

## Populated catalog

First visit seeds 14 research profiles, 10 research grants or strands, and 8 publications, checked against official institutional or research institute sources on October 23, 2026. Coverage emphasizes AI in education, human–AI collaboration, decision making and AI foundations.

Research programs and source URLs:

- NSF Institute for Student-AI Teaming, Colorado Boulder: https://www.colorado.edu/research/ai-institute/about
- iSAT publications: https://www.colorado.edu/research/ai-institute/our-publications
- ARIA AI Institute, Brown: https://www.brown.edu/news/2025-07-29/aria-ai-institute-brown
- NSF AI Institute for Societal Decision Making, Carnegie Mellon: https://www.cmu.edu/ai-sdm/research/
- Pluralistic alignment research: https://www.cmu.edu/ai-sdm/research/research-highlights/pluralistic-alignment.html
- INVITE, UIUC: https://ies.ed.gov/use-work/awards/invite-inclusive-and-innovative-intelligent-technologies-education
- AI for Exceptional Education, Buffalo: https://www.buffalo.edu/ai4exceptionaled/about-us.html
- Institute for Foundations of Machine Learning, UT Austin: https://ai.utexas.edu/news/2025/ut-lead-next-gen-ai
- AI-Materials Institute, Cornell: https://news.cornell.edu/stories/2025/07/national-science-foundation-announces-cornell-led-ai-materials-institute

Some strands are subprojects of listed institutes, not independent federal grants. This is a deliberately selective starter set, not a national census.

## Workflow

1. Open Research Atlas in the Chatdex sidebar.
2. Browse Projects, Researchers, Papers, and My investigations.
3. Search instantly across the saved catalog. Press Import from OpenAlex to retrieve the first 25 U.S.-affiliated grant, author or recent open-access publication records matching the query.
4. In a grant detail, Find grant-linked papers queries OpenAlex for works associated with that grant identifier (first 25 matches).
5. Save an investigation status (saved, reproducing, contacted, completed) and notes. Copy contact prep creates a research contact checklist, not an outbound message.
6. Export atlas JSON creates a local backup of all indexed records and notes.

## Data and privacy

- New entities live in a separate browser Dexie / IndexedDB database, chatdex-research-atlas. Data is local to that browser and does not sync through Chatdex cloud storage.
- Curated entries retain institutional URLs. OpenAlex imports retain OpenAlex IDs and OpenAlex source metadata.
- The search queries use https://api.openalex.org/awards, /authors, /works with U.S. institution filters. These are limited first-page imports, not a bulk nationwide ingestion.
- Live imports require an internet connection and may be subject to OpenAlex keyless usage limits. No API key is needed for the curated seed; a server-side key would be appropriate for larger-scale ingestion.
- No private conversations or research notes are transmitted to OpenAlex. Nothing in this feature sends email or collects private contact details.

## Interpretation limits

- An OpenAlex author is not necessarily a professor; faculty status must be checked on the university website.
- An award's listing and grant dates do not confirm that a project is active or that its lab is recruiting.
- An independently suggested experiment is not an advertised collaboration opportunity.
- OpenAlex grant-to-paper relationships and university affiliations can be incomplete; grant-number matches should be manually checked.
- A paper's presence does not mean its dataset or code is publicly available. Respect software/data licenses, sensitive research data and human-subject research approvals.
- Some curated papers link to an institution's publication list, not a DOI. Verify any citation using the source page.
- The seed does not auto-refresh; live search is manual.

## Architecture

- types.ts: Researcher, ResearchProject, ResearchPaper, Investigation.
- seed.ts: source-backed curated records.
- openalex.ts: API parsing, filters, project/author/paper normalization, grant-linked publications.
- storage.ts: persistent local records, deduplication, notes and JSON export.
- ResearchAtlasPage.tsx: browser, detail panels, filtering, imports, investigation notebook.
- openalex.test.ts: mocked API tests for normalization, US scope and award links.

## Follow-on work

Add verified academic ranks and institution filters, full pagination, scheduled backend refresh with API keys, citations at the record-relationship level, links to open data and code, evidence-backed reproducibility checks, and integration into Chatdex's existing living-understanding workspace. Do not automate unsolicited researcher outreach.
