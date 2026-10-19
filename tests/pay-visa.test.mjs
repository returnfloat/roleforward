// Pay parsing and the pay floor (pay.mjs), and what a posting says about visa sponsorship (visa.mjs).
// Both modules read the workspace when they load, so the workspace is built before they're imported.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkspace } from './fixture.mjs';

const ws = buildWorkspace({ pay: { min: 180000, drop_below: 10, unlisted: 'keep' }, visa: true });
process.env.ROLEFORWARD_WORKSPACE_DIR = ws.root;
const { parsePay, payFit, payText, PAY_ON } = await import('../plugins/roleforward/tools/pay.mjs');
const { sponsorshipText, daysLeft, deadlineLine, visaOn, history } = await import('../plugins/roleforward/tools/visa.mjs');
test.after(() => ws.cleanup());

test('pay ranges in the usual formats', () => {
  assert.deepEqual(parsePay('$212,000 - $265,000'), { min: 212000, max: 265000 });
  assert.deepEqual(parsePay('272,000 USD - 431,250 USD'), { min: 272000, max: 431250 });
  assert.deepEqual(parsePay('$150K-$200K'), { min: 150000, max: 200000 });
  assert.deepEqual(parsePay('between $150k to $200k a year'), { min: 150000, max: 200000 });
  assert.deepEqual(parsePay('$150,000 – $190,000'), { min: 150000, max: 190000 });
});

test('several ranges merge into the widest, from any of the texts', () => {
  assert.deepEqual(parsePay('Zone A: $150,000 - $180,000', 'Zone B: $165,000 - $210,000'), { min: 150000, max: 210000 });
});

test('years and text without a range give nothing', () => {
  assert.equal(parsePay('2020 - 2024 experience'), null);
  assert.equal(parsePay('Competitive pay'), null);
  assert.equal(parsePay(undefined, ''), null);
});

test('hourly ranges count at 2,080 hours a year, and other small dollar ranges are ignored', () => {
  assert.deepEqual(parsePay('The pay range for this position is $90.08 - $127.17/hour.'), { min: 187366, max: 264514, hourly: { min: 90.08, max: 127.17 } });
  assert.deepEqual(parsePay('Pay Range: $72.15/hr - $98.40/hr'), { min: 150072, max: 204672, hourly: { min: 72.15, max: 98.4 } });
  assert.deepEqual(parsePay('$61.41 to $79.45 Hourly'), { min: 127733, max: 165256, hourly: { min: 61.41, max: 79.45 } });
  assert.deepEqual(parsePay('Hourly pay: $45.00 - $60.00'), { min: 93600, max: 124800, hourly: { min: 45, max: 60 } });
  for (const t of ['coordinating 8 to 10 staff', '$25 - $30 gift card', 'Bonus $5 - $10 per shift differential']) assert.equal(parsePay(t), null, t);
});

test('the pay check shows an hourly range as posted, with its yearly equivalent', () => {
  assert.deepEqual(payFit(parsePay('$90.08 - $127.17/hour')), { drop: false, text: 'reaches your floor (posted $90.08 to $127.17 an hour, about $187,366 to $264,514 a year at 2,080 hours, your floor $180,000)' });
  assert.equal(payFit(parsePay('$40.00 - $60.00 an hour')).drop, true, '$124,800 a year at most');
});

test('the pay floor drops only ranges more than drop_below percent under it', () => {
  assert.equal(PAY_ON, true);
  assert.deepEqual(payFit({ min: 170000, max: 200000 }), { drop: false, text: 'reaches your floor (posted $170,000 to $200,000, your floor $180,000)' });
  assert.equal(payFit({ min: 150000, max: 170000 }).drop, false);
  assert.match(payFit({ min: 150000, max: 170000 }).text, /^below your floor, within 10%/);
  assert.equal(payFit({ min: 120000, max: 160000 }).drop, true);
  assert.match(payFit({ min: 120000, max: 160000 }).text, /more than 10% below your floor .*: drop$/);
});

test('postings without pay are kept when unlisted is keep', () => {
  assert.deepEqual(payFit(null), { drop: false, text: 'not published (your setting: keep postings without pay)' });
});

test('sponsorship: a clear no, citizenship, a clear yes, and nothing', () => {
  assert.equal(sponsorshipText('We are unable to sponsor visas for this role.').says, 'no');
  assert.equal(sponsorshipText('This role does not offer visa sponsorship.').says, 'no');
  assert.equal(sponsorshipText('Candidates must be authorized to work without the need for current or future sponsorship.').says, 'no');
  assert.equal(sponsorshipText('U.S. citizenship is required.').says, 'citizens');
  assert.equal(sponsorshipText('An active security clearance is needed.').says, 'citizens');
  assert.equal(sponsorshipText('Visa sponsorship is available for this role.').says, 'yes');
  assert.equal(sponsorshipText('We will sponsor H-1B visas.').says, 'yes');
  assert.deepEqual(sponsorshipText('Example responsibilities.'), { says: '', quote: '' });
});

test('sponsor wording needs visa context when it could mean something else', () => {
  assert.equal(sponsorshipText('We do not sponsor relocation.').says, '');
  assert.equal(sponsorshipText('You will work with an executive sponsor.').says, '');
});

test("the quote is the posting's own sentence", () => {
  assert.equal(sponsorshipText('Example intro. We are unable to sponsor visas for this role. More text.').quote, 'We are unable to sponsor visas for this role');
});

test('the visa deadline counts down from the setting', () => {
  assert.equal(visaOn(), true);
  assert.equal(daysLeft(), 30);
  assert.match(deadlineLine(), /^Visa deadline: 30 days left \(\d{4}-\d{2}-\d{2}, H-1B\)\.$/);
});

test('sponsor history counts the exact name and its aliases, and lists similar and abbreviated names apart', () => {
  ws.write('applications/data/sponsors.csv', 'norm,employer,years,initial_approvals,continuing_approvals,denials,by_year\n'
    + 'employer a,Employer A,2023,10,20,1,{}\nemployer a subsidiary,Employer A Subsidiary,2023,5,5,0,{}\n'
    + 'employer a labs,Employer A Labs,2023,3,3,0,{}\nea,EA,2023,2,2,0,{}\nemployer b,Employer B,2023,1,1,0,{}\n');
  const h = history('Employer A');
  assert.deepEqual(h.names, ['Employer A', 'Employer A Subsidiary'], 'the alias from targets.visa.aliases counts');
  assert.deepEqual(h.similar.map(([n]) => n), ['Employer A Labs', 'EA'], 'a longer name and an abbreviation are listed, never counted');
});

test('a parsed range reads back in words', () => {
  assert.equal(payText(parsePay('$90.08 - $127.17/hour')), '$90.08 to $127.17 an hour');
  assert.equal(payText(parsePay('$150,000 - $190,000')), '$150,000 to $190,000');
});
