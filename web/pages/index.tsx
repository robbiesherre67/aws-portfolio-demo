import { useEffect, useState } from 'react';
type Task = { id: string; title: string; status: string; createdAt: string };
const GQL = process.env.NEXT_PUBLIC_GRAPHQL_URL!;
async function gql(query: string, variables?: any) {
  const res = await fetch(GQL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  return res.json();
}
export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const load = async () => { const { data } = await gql(`{ tasks { id title status createdAt } }`); setTasks(data?.tasks ?? []); };
  useEffect(() => { load(); }, []);
  const add = async () => { if (!title.trim()) return; await gql(`mutation($t:String!){ addTask(title:$t){ id } }`, { t: title }); setTitle(''); await load(); };
  const heavy = async (id: string) => { await gql(`mutation($id:ID!){ startHeavyJob(id:$id) }`, { id }); await load(); };
  const done  = async (id: string) => { await gql(`mutation($id:ID!){ completeTask(id:$id){ id } }`, { id }); await load(); };
  return (
    <main style={{ maxWidth: 720, margin: '40px auto', fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>Task Lab (AWS Serverless)</h1>
      <div style={{ display: 'flex', gap: 8, margin: '16px 0' }}>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="New task title" style={{ flex: 1, padding: 8 }} />
        <button onClick={add} style={{ padding: '8px 12px' }}>Add</button>
      </div>
      <ul>
        {tasks.map(t => (
          <li key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #eee' }}>
            <span style={{ width: 100, fontSize: 12, opacity: 0.7 }}>{t.status}</span>
            <span style={{ flex: 1 }}>{t.title}</span>
            <button onClick={() => heavy(t.id)}>Start job</button>
            <button onClick={() => done(t.id)}>Complete</button>
          </li>
        ))}
      </ul>
    </main>
  );
}
