import type { Researcher, ResearchProject, ResearchPaper } from './types';

// Curated starter catalog, checked against official institutional pages on 2026-10-23.
// This is not an exhaustive directory or a claim that labs are recruiting contributors.
const checked = '2026-10-23';
const person = (
  id: string, name: string, institution: string, role: string, topics: string[],
  projectIds: string[], sourceUrl: string,
): Researcher => ({ id, name, institution, role, topics, projectIds, sourceUrl, origin: 'curated', verifiedAt: checked });

const cu = 'University of Colorado Boulder';
const cmu = 'Carnegie Mellon University';
const bw = 'Brown University';
const ic = 'University of Illinois Urbana-Champaign';
const h = 'Harvard University';
const bt = 'University at Buffalo';
const ut = 'The University of Texas at Austin';

const isat = 'https://www.colorado.edu/research/ai-institute/';
const cmuResearch = 'https://www.cmu.edu/ai-sdm/research/';
const cmuTeam = 'https://www.cmu.edu/ai-sdm/who-we-are/';
const brown = 'https://www.brown.edu/news/2025-07-29/aria-ai-institute-brown';
const invite = 'https://ies.ed.gov/use-work/awards/invite-inclusive-and-innovative-intelligent-technologies-education';
const exceptional = 'https://www.buffalo.edu/ai4exceptionaled/about-us.html';
const ifml = 'https://ai.utexas.edu/news/2025/ut-lead-next-gen-ai';
const materials = 'https://news.cornell.edu/stories/2025/07/national-science-foundation-announces-cornell-led-ai-materials-institute';
const pluralist = 'https://www.cmu.edu/ai-sdm/research/research-highlights/pluralistic-alignment.html';

export const seedResearchers: Researcher[] = [
  person('r-sidney', "Sidney D'Mello", cu, 'Professor; iSAT principal investigator', ['AI in education','Human–AI collaboration','Learning sciences'], ['p-isat','p-classroom'], isat + 'sidney-dmello'),
  person('r-tamara', 'Tamara Sumner', cu, 'Professor; iSAT co-PI', ['AI in education','Learning sciences'], ['p-isat','p-classroom'], isat + 'tamara-sumner'),
  person('r-ellie', 'Ellie Pavlick', bw, 'Associate professor; ARIA director', ['Language models','Human–AI collaboration','AI safety'], ['p-aria'], brown),
  person('r-suresh', 'Suresh Venkatasubramanian', bw, 'Professor; ARIA co-director', ['AI safety','Responsible AI'], ['p-aria'], brown),
  person('r-aarti', 'Aarti Singh', cmu, 'Professor; AI-SDM director', ['Machine learning','Decision-making'], ['p-ai-sdm','p-pluralist'], cmuTeam),
  person('r-coty', 'Cleotilde Gonzalez', cmu, 'Professor; AI-SDM co-director', ['Cognitive science','Decision-making'], ['p-ai-sdm','p-cognitive'], cmuTeam),
  person('r-jeff', 'Jeff Schneider', cmu, 'Research professor; AI-SDM co-PI', ['Machine learning','Decision-making'], ['p-ai-sdm'], cmuTeam),
  person('r-ariel', 'Ariel Procaccia', h, 'Professor; AI-SDM co-PI', ['Algorithms','AI alignment','Decision-making'], ['p-ai-sdm','p-pluralist'], cmuTeam),
  person('r-christopher', 'Christopher Dancy', 'Pennsylvania State University', 'Associate professor; AI-SDM cognitive research lead', ['Cognitive science','Decision-making'], ['p-cognitive'], cmuResearch),
  person('r-chad', 'Chad Lane', ic, 'INVITE principal investigator (faculty rank not verified)', ['AI in education','Learning sciences'], ['p-invite'], invite),
  person('r-venu', 'Venu Govindaraju', bt, 'AI4ExceptionalEd director and PI', ['Accessibility','Speech and language','AI in education'], ['p-exceptional'], exceptional),
  person('r-julie', 'Julie Kientz', 'University of Washington', 'AI4ExceptionalEd co-PI', ['Human–computer interaction','Accessibility'], ['p-exceptional'], exceptional),
  person('r-adam', 'Adam Klivans', ut, 'Professor; IFML director', ['Machine learning','AI foundations'], ['p-ifml'], 'https://www.cs.utexas.edu/people/faculty-researchers/adam-klivans'),
  person('r-eunah', 'Eun-Ah Kim', 'Cornell University', 'Professor of physics; AI-MI director', ['Materials science','AI for science'], ['p-materials'], materials),
];

const project = (
  id: string, title: string, institution: string, description: string, topics: string[],
  researcherIds: string[], paperIds: string[], sourceUrl: string,
  kind: 'grant' | 'research-strand', suggestedContribution: string, awardNumber?: string,
  funder?: string,
): ResearchProject => ({
  id, title, institution, description, topics, researcherIds, paperIds, sourceUrl,
  origin: 'curated', verifiedAt: checked, kind, suggestedContribution, awardNumber, funder,
});

export const seedProjects: ResearchProject[] = [
  project('p-isat','NSF Institute for Student-AI Teaming (iSAT)',cu,
    'Research on AI partners that collaborate with student groups and teachers, classroom dialogue and AI literacy.',
    ['AI in education','Human–AI collaboration','Learning sciences'],['r-sidney','r-tamara'],
    ['w-communicative','w-jigsaw','w-speech','w-codesign','w-diarization'],isat + 'about','grant',
    'Reproduce an open teamwork or classroom-dialogue metric on a publicly licensed dataset, if one is available.','2454151','NSF'),
  project('p-classroom','AI partners for collaborative classroom learning',cu,
    'An iSAT research strand that develops computational models and educational AI partners for collaborative reasoning.',
    ['AI in education','Human–AI collaboration','Speech and language'],['r-sidney','r-tamara'],
    ['w-jigsaw','w-speech'],isat + 'our-research','research-strand',
    'Compare group-discussion metrics with a small reproducible benchmark using non-sensitive public data.'),
  project('p-aria','AI Research Institute on Interaction for AI Assistants (ARIA)',bw,
    'Research on trustworthy and context-aware AI assistants, subjective domains and participatory design.',
    ['Human–AI collaboration','AI safety','Language models'],['r-ellie','r-suresh'],[],brown,'grant',
    'Reproduce a public evaluation of context retention or assistant reliability using synthetic or consented examples.','2433429','NSF'),
  project('p-ai-sdm','NSF AI Institute for Societal Decision Making',cmu,
    'Combines cognitive and AI research for human-centred decisions in disaster management and public health.',
    ['Decision-making','Human–AI collaboration','AI safety'],['r-aarti','r-coty','r-jeff','r-ariel'],[],cmuResearch,'grant',
    'Create a transparent simulation comparing human-only, AI-only and human–AI decisions.','2229881','NSF'),
  project('p-pluralist','Multi-objective and pluralistic human alignment',cmu + ' / ' + h,
    'Studies alignment of machine-learning systems to multiple human preferences and objectives.',
    ['AI alignment','AI safety','Decision-making'],['r-aarti','r-ariel'],
    ['w-pairwise','w-axioms','w-rlhf'],pluralist,'research-strand',
    'Reimplement a small multi-objective preference aggregation benchmark and document tradeoffs.'),
  project('p-cognitive','Computational representation of human decision processes',cmu + ' / Pennsylvania State University',
    'Research on how people decide under uncertainty, informing AI decision-support models.',
    ['Cognitive science','Decision-making','Human–AI collaboration'],['r-coty','r-christopher'],[],cmuResearch,'research-strand',
    'Reproduce a small cognitive decision model on synthetic or openly licensed decision datasets.'),
  project('p-invite','INVITE: Inclusive and Intelligent Technologies for Education',ic,
    'Develops learning tools that support persistence, academic resilience and collaboration.',
    ['AI in education','Learning sciences'],['r-chad'],[],invite,'grant',
    'Reproduce a public measure of learner persistence and examine whether it predicts learning outcomes.','2229612','NSF / IES'),
  project('p-exceptional','NSF AI Institute for Exceptional Education',bt,
    'Studies AI approaches for speech-language screening and educational support for children.',
    ['AI in education','Accessibility','Speech and language'],['r-venu','r-julie'],[],exceptional,'grant',
    'Evaluate reproducibility of an open speech baseline on licensed non-clinical data. Do not claim clinical validity.','2229873','NSF / IES'),
  project('p-ifml','NSF Institute for Foundations of Machine Learning',ut,
    'Foundational and open-source ML research, including generative models, robustness and scientific applications.',
    ['Machine learning','AI foundations','Open-source research'],['r-adam'],[],ifml,'grant',
    'Reproduce a small OpenCLIP or DataComp benchmark using openly available code and datasets.','2505865','NSF'),
  project('p-materials','NSF AI-Materials Institute','Cornell University',
    'Integrates scientific expertise and AI methods to accelerate materials discovery.',
    ['AI for science','Materials science','Machine learning'],['r-eunah'],[],materials,'grant',
    'Benchmark an open scientific-text or materials-property baseline on a small licensed dataset.','2433348','NSF'),
];

const pub = isat + 'our-publications';
const paper = (id:string, title:string, year:number, authors:string[], projectIds:string[],
  researcherIds:string[], sourceUrl:string):ResearchPaper => ({
  id, title, year, authors, projectIds, researcherIds, sourceUrl, origin:'curated',
});
export const seedPapers: ResearchPaper[] = [
  paper('w-communicative','Communicative Influence: A Novel Measure of Team Dynamics that Integrates Team Cognition Theory with Collaborative Problem Solving Assessment',2025,
    ['Reitman, J. G.','Harrison, J. L.','Gorman, J. C.','Lieber, R.',"D'Mello, S. K."],['p-isat'],['r-sidney'],pub),
  paper('w-jigsaw','Piecing Together Teamwork: A Responsible Approach to an LLM-based Educational Jigsaw Agent',2025,
    ['Doherty, E.','Perkoff, M. E.','Von Bayern, S.','Zhang, R.','Dey, I.','Puntambekar, S.','Hirshfield, L.'],['p-isat','p-classroom'],[],pub),
  paper('w-speech','Speech Is Not Enough: Interpreting Nonverbal Indicators of Common Knowledge and Engagement',2025,
    ['Palmer, D.','Zhu, Y.','Lai, K.','VanderHoeven, H.','Bradford, M.','Khebour, I.','Mabrey, C.','Fitzgerald, J.','Li, Z.','Krishnaswamy, N.','Palmer, M.','Pustejovsky, J.'],['p-isat','p-classroom'],[],pub),
  paper('w-codesign','Co-designing AI with Youth Partners: Enabling Ideal Classroom Relationships through a Novel AI Privacy Framework',2025,
    ['Chang, M. A.','Tissenbaum, M.','Philip, T. M.',"D'Mello, S. K."],['p-isat'],['r-sidney'],pub),
  paper('w-diarization','Speaker Diarization in the Classroom: How Much Does Each Student Speak in Group Discussions?',2024,
    ['Wang, J.','Dudy, Sh.','He, X.','Wang, Z.','Southwell, R.','Whitehill, J.'],['p-isat'],[],pub),
  // The AI-SDM webpage explicitly lists these outputs. Years/authorships
  // are intentionally omitted unless verified from the publication record.
  paper('w-pairwise','Pairwise Calibrated Rewards for Pluralistic Alignment',0,[],['p-pluralist'],[],pluralist),
  paper('w-axioms','Axioms for AI Alignment from Human Feedback',0,[],['p-pluralist'],[],pluralist),
  paper('w-rlhf','General Framework for Multi-Objective and Multi-Group RLHF',0,[],['p-pluralist'],[],pluralist),
];
