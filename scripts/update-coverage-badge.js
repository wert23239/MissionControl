#!/usr/bin/env node
// Reads Jest coverage-final.json and writes coverage-badge.json for the dashboard
const fs = require('fs');
const path = require('path');

const coveragePath = path.join(__dirname, '..', 'coverage', 'coverage-final.json');
const badgePath = path.join(__dirname, '..', 'coverage-badge.json');

try {
  const data = JSON.parse(fs.readFileSync(coveragePath, 'utf8'));
  
  let totalStmts = 0, coveredStmts = 0;
  let totalBranch = 0, coveredBranch = 0;
  let totalFuncs = 0, coveredFuncs = 0;
  let totalLines = 0, coveredLines = 0;

  for (const file of Object.values(data)) {
    // Statements
    for (const v of Object.values(file.s || {})) { totalStmts++; if (v > 0) coveredStmts++; }
    // Branches
    for (const v of Object.values(file.b || {})) { 
      for (const count of v) { totalBranch++; if (count > 0) coveredBranch++; }
    }
    // Functions
    for (const v of Object.values(file.f || {})) { totalFuncs++; if (v > 0) coveredFuncs++; }
    // Lines (use statement map as proxy)
    const lineHits = {};
    for (const [k, v] of Object.entries(file.statementMap || {})) {
      const line = v.start.line;
      if (!lineHits[line]) lineHits[line] = 0;
      lineHits[line] += file.s[k] || 0;
    }
    for (const v of Object.values(lineHits)) { totalLines++; if (v > 0) coveredLines++; }
  }

  const pct = (c, t) => t > 0 ? Math.round(c / t * 1000) / 10 : 0;

  const badge = {
    statements: pct(coveredStmts, totalStmts),
    branches: pct(coveredBranch, totalBranch),
    functions: pct(coveredFuncs, totalFuncs),
    lines: pct(coveredLines, totalLines),
    updated: new Date().toISOString(),
  };

  fs.writeFileSync(badgePath, JSON.stringify(badge) + '\n');
  console.log('Coverage badge updated:', badge);
} catch (e) {
  console.error('Failed to update coverage badge:', e.message);
}
