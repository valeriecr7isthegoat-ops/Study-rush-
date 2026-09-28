import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const client = () => {
  if (!process.env.OPENAI_API_KEY) throw new Error('The server owner has not configured OPENAI_API_KEY in Render.');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
};

app.get('/', (_req, res) => res.json({ name: 'Study Rush AI Backend', ok: true }));
app.get('/api/health', (_req, res) => res.json({ ok: true, aiConfigured: Boolean(process.env.OPENAI_API_KEY), model: MODEL }));

function text(value, max = 6000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
function context(body = {}) {
  const grade = text(body.grade, 80) || 'not specified';
  const subjects = Array.isArray(body.subjects) ? body.subjects.map(x => text(x, 60)).filter(Boolean).slice(0, 12).join(', ') : '';
  return `Student grade/class: ${grade}. Selected subjects: ${subjects || 'not specified'}. Use clear, age-appropriate language. Teach step by step, explain key reasoning, and do not pretend this is a standardized assessment.`;
}
async function ask(system, user, max_tokens = 1200) {
  const response = await client().chat.completions.create({
    model: MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens,
    temperature: 0.7
  });
  return response.choices?.[0]?.message?.content?.trim() || 'Sorry, I could not generate a response. Please try again.';
}
function handler(fn) {
  return async (req, res) => {
    try { res.json(await fn(req.body || {})); }
    catch (err) {
      console.error('Study Rush request failed:', err?.message || err);
      const message = err?.status === 401
        ? 'The server API key was rejected. Check OPENAI_API_KEY in Render.'
        : err?.status === 429
          ? 'The AI service is temporarily rate-limited or out of available quota. Try again later.'
          : (err?.message || 'The AI request failed. Please try again.');
      res.status(err?.status && err.status >= 400 && err.status < 500 ? err.status : 500).json({ error: message });
    }
  };
}

app.post('/api/chat', handler(async body => {
  const message = text(body.message);
  if (!message) throw Object.assign(new Error('Please enter a message.'), { status: 400 });
  const reply = await ask(`You are Study Rush, a friendly school tutor. ${context(body)} Answer the student's question clearly, encourage learning, and show steps when useful.`, message);
  return { reply };
}));

app.post('/api/homework', handler(async body => {
  const question = text(body.question);
  if (!question) throw Object.assign(new Error('Please enter a homework question.'), { status: 400 });
  const answer = await ask(`You are Study Rush Homework Helper. ${context(body)} Help the student learn: give the correct answer when appropriate, show the method and reasoning, define important terms, and include a short check-your-understanding tip when useful. Follow any additional instruction if it is safe and relevant: ${text(body.instruction, 1000)}`, question, 1600);
  return { answer };
}));

app.post('/api/notes', handler(async body => {
  const topic = text(body.topic, 300);
  if (!topic) throw Object.assign(new Error('Please enter a topic for your notes.'), { status: 400 });
  const answer = await ask(`You create accurate, student-friendly revision notes. ${context(body)} Organize the notes with a clear title, short sections, definitions, key points, examples, and a brief recap. Use plain text headings and bullets; avoid claiming facts you are unsure of.`, `Make revision notes on: ${topic}`, 1800);
  return { answer };
}));

app.post('/api/quiz', handler(async body => {
  const topic = text(body.topic, 300) || 'general school knowledge';
  const count = Math.max(1, Math.min(10, Number.parseInt(body.count, 10) || 5));
  const raw = await ask(`Create exactly ${count} distinct multiple-choice school quiz questions. ${context(body)} Topic: ${topic}. Return ONLY valid JSON in this exact shape: {"questions":[{"question":"...","options":["A...","B...","C...","D..."],"answer":0,"explanation":"..."}]}. Each question must have exactly four plausible options. answer must be a zero-based integer from 0 to 3. Explanations should briefly explain the correct answer. Do not include markdown fences or text outside the JSON.`, `Generate ${count} questions about ${topic}.`, 3000);
  let parsed;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    parsed = JSON.parse(cleaned);
  } catch {
    const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('The quiz response was not valid JSON. Please generate the quiz again.');
    parsed = JSON.parse(raw.slice(start, end + 1));
  }
  const questions = Array.isArray(parsed.questions) ? parsed.questions.filter(q =>
    q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length === 4 &&
    Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4
  ).slice(0, count) : [];
  if (questions.length < count) throw new Error('The AI returned too few valid questions. Please generate the quiz again.');
  return { questions };
}));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(400).json({ error: 'Invalid request.' });
});

app.listen(PORT, '0.0.0.0', () => console.log(`Study Rush backend listening on port ${PORT}`));
