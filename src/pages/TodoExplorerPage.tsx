/**
 * A second, distinct program to test whether the visual engineering workspace
 * generalizes beyond queues. Every task mutation invokes todoModel.ts.
 */
import { useReducer, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, Code2, Maximize2, Minimize2, Plus } from 'lucide-react';
import { SourceExcerpt } from '../components/engineering/SourceExcerpt';
import { Badge, button, muted } from '../components/engineering/ui';
import { initialTodoState, todoTransition, type TodoAction } from '../lib/engineering/todoModel';
import { exampleConceptId } from '../lib/engineering/demoProjects';
import type { LandscapeRegion } from '../types/landscape';
import todoSource from '../lib/engineering/todoModel.ts?raw';
import todoTestSource from '../lib/engineering/todoModel.test.ts?raw';

type TodoNode = 'input' | 'list' | 'active' | 'completed' | 'archive' | 'tests';
type InspectorTab = 'understand' | 'code' | 'tests';

const NODES: Record<TodoNode, { title: string; subtitle: string; summary: string; detail: string; needle: string }> = {
  input: { title: 'Task input', subtitle: 'Create', summary: 'Create a new task with a title.', detail: 'addTask() validates a name, allocates a stable ID, and appends an incomplete task.', needle: 'export function addTask' },
  list: { title: 'Task list', subtitle: 'Collection', summary: 'The state contains an ordered collection of task records.', detail: 'The reducer returns new state objects instead of mutating an existing list. This lets the interface render the latest task collection.', needle: 'export interface TodoState' },
  active: { title: 'Active', subtitle: 'To do', summary: 'Incomplete tasks remain actionable.', detail: 'toggleTask() flips completed while preserving the task ID and title. A task stays in the list when marked done.', needle: 'export function toggleTask' },
  completed: { title: 'Completed', subtitle: 'Done', summary: 'Completed tasks are still stored until cleared.', detail: 'Marking a task done changes completed from false to true. It does not remove the task.', needle: 'export function toggleTask' },
  archive: { title: 'Remove', subtitle: 'Clear', summary: 'Delete one task or clear completed work.', detail: 'removeTask() deletes one ID; clearCompleted() removes every completed task. These are explicit changes to state, not background cleanup.', needle: 'export function clearCompleted' },
  tests: { title: 'Tests', subtitle: 'Inspect', summary: 'Pure tests check the task state transitions.', detail: 'The tests cover addition, completion, stable IDs, immutable state and removal. This Explorer displays their source; it does not run Vitest in the browser.', needle: 'export function todoTransition' },
};

const LAYOUT: TodoNode[] = ['input', 'list', 'active', 'tests', 'archive', 'completed'];
const source = { path: 'src/lib/engineering/todoModel.ts', repoPath: 'src/lib/engineering/todoModel.ts', text: todoSource };
const tests = { path: 'src/lib/engineering/todoModel.test.ts', repoPath: 'src/lib/engineering/todoModel.test.ts', text: todoTestSource };

interface Props {
  projectId: string;
  projectName: string;
  concepts?: LandscapeRegion[];
}

export function TodoExplorerPage({ projectId, projectName, concepts = [] }: Props) {
  const [state, dispatch] = useReducer(todoTransition, undefined, initialTodoState);
  const [title, setTitle] = useState('');
  const [selected, setSelected] = useState<TodoNode>('list');
  const [tab, setTab] = useState<InspectorTab>('understand');
  const [inspectorFocused, setInspectorFocused] = useState(false);
  const [lastAction, setLastAction] = useState('Add a task to begin.');
  const [highlighted, setHighlighted] = useState<TodoNode[]>(['list']);

  const selectNode = (node: TodoNode) => setSelected(node);
  const titleOf = (node: TodoNode) => concepts.find((concept) => concept.id === exampleConceptId('todo-list', node))?.title ?? NODES[node].title;
  const apply = (action: TodoAction, focus: TodoNode, message: string) => {
    dispatch(action);
    setSelected(focus);
    setHighlighted([focus, 'list']);
    setLastAction(message);
  };
  const add = () => {
    if (!title.trim()) return;
    apply({ type: 'add', title }, 'input', 'Added "' + title.trim() + '" through addTask().');
    setTitle('');
  };
  const part = NODES[selected];
  const countCompleted = state.items.filter((task) => task.completed).length;

  return (
    <div className="mx-auto flex h-[calc(100dvh-5.5rem)] min-h-[440px] max-w-7xl flex-col gap-3 overflow-hidden text-gray-900 dark:text-gray-100 sm:h-[calc(100dvh-6.5rem)]">
      <header className="flex shrink-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><BookOpen size={18} className="shrink-0 text-violet-600" /><h1 className="truncate text-base font-semibold sm:text-xl">{projectName}</h1><Badge tone="green">Live</Badge></div>
          <p className={'text-[11px] ' + muted}>Real task state · authored diagram · browser session only</p>
        </div>
        <Link to={'/projects/' + projectId} className={button}><ArrowLeft size={14} /> Project</Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(370px,.95fr)]">
        <div className={(inspectorFocused ? 'hidden lg:flex' : 'flex') + ' min-h-0 shrink-0 flex-col gap-2 lg:min-h-0 lg:shrink'}>
          <section className="shrink-0 rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-900" aria-label="Todo system diagram">
            <div className="mb-2 flex justify-between gap-2"><span className="text-xs font-semibold">Task workflow</span><span className={'text-[10px] ' + muted}>Tap any part</span></div>
            <div className="grid grid-cols-3 gap-2">
              {LAYOUT.map((node, index) => {
                const current = NODES[node];
                const chosen = selected === node;
                const active = highlighted.includes(node);
                const count = node === 'active' ? state.items.length - countCompleted : node === 'completed' ? countCompleted : node === 'list' ? state.items.length : null;
                return (
                  <button key={node} type="button" aria-pressed={chosen} onClick={() => selectNode(node)} data-node={node} data-highlighted={active ? 'true' : undefined}
                    className={'relative flex min-h-[60px] min-w-0 flex-col items-center justify-center rounded-lg border px-1 text-center focus-visible:outline-2 focus-visible:outline-violet-600 ' +
                      (chosen ? 'border-violet-500 bg-violet-100 ring-2 ring-violet-400 dark:bg-violet-950' :
                        active ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950' : 'border-gray-300 dark:border-gray-600')}>
                    <span className="text-[11px] font-semibold sm:text-xs">{titleOf(node)}</span>
                    <span className={'text-[9px] ' + muted}>{current.subtitle}{count !== null ? ' · ' + count : ''}</span>
                    {(index === 0 || index === 1 || index === 4) && <span aria-hidden="true" className="absolute -right-2.5 z-10 text-gray-500">→</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="shrink-0 rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 dark:border-emerald-900 dark:bg-emerald-950/20" aria-label="Live todo controls">
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); add(); }}>
              <input aria-label="New task" value={title} onChange={(event) => setTitle(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                placeholder="What needs doing?" />
              <button type="submit" disabled={!title.trim()} className={button}><Plus size={14} /> Add</button>
            </form>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">{state.items.length - countCompleted} active · {countCompleted} completed</p>
              <button type="button" className="text-xs text-violet-700 underline disabled:opacity-50 dark:text-violet-300" disabled={!countCompleted}
                onClick={() => apply({ type: 'clear-completed' }, 'archive', 'Cleared completed tasks.')}>Clear completed</button>
            </div>
            <div className="mt-2 max-h-28 space-y-1 overflow-y-auto" aria-label="Todo items">
              {state.items.length === 0 && <p className={'text-xs ' + muted}>No tasks yet. Try adding one.</p>}
              {state.items.map((task) => (
                <div key={task.id} className="flex items-center gap-2 rounded-md bg-white px-2 py-1.5 text-xs dark:bg-gray-800">
                  <input type="checkbox" aria-label={'Complete ' + task.title} checked={task.completed}
                    onChange={() => apply({ type: 'toggle', id: task.id }, task.completed ? 'active' : 'completed', 'Toggled ' + task.id + ' using toggleTask().')} />
                  <span className={'min-w-0 flex-1 truncate ' + (task.completed ? 'line-through opacity-50' : '')}>{task.title}</span>
                  <button type="button" aria-label={'Remove ' + task.title} onClick={() => apply({ type: 'remove', id: task.id }, 'archive', 'Removed ' + task.id + '.')}
                    className="rounded px-1 text-red-700 hover:bg-red-50 dark:text-red-300">×</button>
                </div>
              ))}
            </div>
            <p aria-live="polite" className={'mt-1.5 truncate text-[11px] ' + muted}>{lastAction} · {state.step} model transitions</p>
          </section>
          <p className={'shrink-0 text-[10px] ' + muted}>Pure todo reducer executes in this browser. Changes reset on reload; this is not your personal task list.</p>
        </div>

        <section aria-label="Todo inspector" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0"><p className={'text-[10px] uppercase ' + muted}>Selected concept · project model</p><h2 className="truncate font-semibold">{titleOf(selected)}</h2></div>
            <button className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 dark:border-gray-700 lg:hidden" type="button" aria-label={inspectorFocused ? 'Show diagram' : 'Expand inspector'} onClick={() => setInspectorFocused(!inspectorFocused)}>{inspectorFocused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
          </div>
          <div role="tablist" aria-label="Todo inspector views" className="flex shrink-0 border-b border-gray-200 dark:border-gray-700">
            {(['understand', 'code', 'tests'] as const).map((name) => (
              <button key={name} type="button" role="tab" aria-selected={name === tab} onClick={() => setTab(name)}
                className={'min-h-11 flex-1 border-b-2 text-sm capitalize ' + (name === tab ? 'border-violet-600 font-semibold text-violet-700 dark:text-violet-300' : 'border-transparent text-gray-500')}>{name}</button>
            ))}
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3" role="tabpanel" key={selected + tab}>
            {tab === 'understand' && (
              <div className="space-y-3 text-sm">
                <p className="font-semibold">{part.summary}</p><p className="leading-6">{part.detail}</p>
                <p className={'text-xs ' + muted}>Model concept ID: {exampleConceptId('todo-list', selected)}. The concept is persisted in the Chatdex project; runtime task state is not.</p>
                <button type="button" className={button} onClick={() => { setTab('code'); setInspectorFocused(true); }}><Code2 size={14} /> Inspect actual implementation <ArrowRight size={13} /></button>
                <nav aria-label="Related project workflows" className="flex flex-wrap gap-2 border-t border-gray-200 pt-3 text-xs dark:border-gray-700">
                  <span className={'w-full ' + muted}>Related project views (currently separate):</span>
                  <Link className={button} to={'/projects/' + projectId + '/investigate'}>History</Link>
                  <Link className={button} to={'/projects/' + projectId + '/understanding'}>Understanding</Link>
                  <Link className={button} to={'/projects/' + projectId + '/prepare'}>Prepare Change</Link>
                </nav>

              </div>
            )}
            {tab === 'code' && (
              <div className="space-y-2"><p className={'text-xs ' + muted}>Real reducer source bundled with this build, not editable or revision-pinned.</p><SourceExcerpt source={source} title={titleOf(selected)} needle={part.needle} /></div>
            )}
            {tab === 'tests' && (
              <div className="space-y-2"><p className={'text-xs ' + muted}>Actual Vitest test source. These tests do not run when you use the Explorer.</p><SourceExcerpt source={tests} title="Todo model tests" needle="describe('Todo engineering example'" /></div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
