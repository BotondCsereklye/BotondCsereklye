import fs from "node:fs";
import path from "node:path";

const RESPAWN_DELAY_MS = 5000;
const EMPTY_FILL = "var(--ce)";
const EPSILON = 0.02;
const CROPPED_VIEWBOX = 'viewBox="0 0 848 112" width="848" height="112"';

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error("Usage: node scripts/postprocess-snake.mjs <svg-file> [<svg-file>...]");
  process.exit(1);
}

for (const file of files) {
  const absolutePath = path.resolve(file);
  const originalSvg = fs.readFileSync(absolutePath, "utf8");
  const durationMs = readAnimationDuration(originalSvg);
  const fillByCommitClass = readCommitFillMap(originalSvg);

  let nextSvg = cropToContributionGrid(originalSvg);
  nextSvg = addRespawnAnimation(nextSvg, durationMs, fillByCommitClass);

  fs.writeFileSync(absolutePath, nextSvg);
}

function readAnimationDuration(svg) {
  const durationMatch = svg.match(/animation:none\s+([0-9.]+)ms\s+linear\s+infinite/);

  if (!durationMatch) {
    throw new Error("Could not find snake animation duration in the SVG.");
  }

  return Number(durationMatch[1]);
}

function readCommitFillMap(svg) {
  const fillByCommitClass = new Map();
  const classPattern = /\.c\.(c[0-9a-z]+)\{fill:(var\(--c[0-9a-z]+\));animation-name:\1\}/g;

  for (const match of svg.matchAll(classPattern)) {
    fillByCommitClass.set(match[1], match[2]);
  }

  return fillByCommitClass;
}

function cropToContributionGrid(svg) {
  return svg.replace(/viewBox="[^"]+"\s+width="[^"]+"\s+height="[^"]+"/, CROPPED_VIEWBOX);
}

function addRespawnAnimation(svg, durationMs, fillByCommitClass) {
  const respawnDelayPercent = (RESPAWN_DELAY_MS / durationMs) * 100;
  const keyframePattern = /@keyframes (c[0-9a-z]+)\{([0-9.]+)%\{fill:[^}]+\}([0-9.]+)%,100%\{fill:var\(--ce\)\}\}/g;

  return svg.replace(
    keyframePattern,
    (fullMatch, animationName, eatenAtStart, eatenAtEnd) => {
      const originalFill = fillByCommitClass.get(animationName);

      if (!originalFill) {
        return fullMatch;
      }

      const visibleUntil = Number(eatenAtStart);
      const hiddenFrom = Number(eatenAtEnd);
      const respawnAt = hiddenFrom + respawnDelayPercent;

      if (respawnAt < 100 - EPSILON) {
        return `@keyframes ${animationName}{0%,${formatPercent(visibleUntil)}%{fill:${originalFill}}${formatPercent(hiddenFrom)}%,${formatPercent(respawnAt)}%{fill:${EMPTY_FILL}}${formatPercent(respawnAt + EPSILON)}%,100%{fill:${originalFill}}}`;
      }

      // Late-eaten commits stay hidden across the loop boundary, then reappear early in the next cycle.
      const hiddenUntilNextLoop = respawnAt - 100;

      return `@keyframes ${animationName}{0%,${formatPercent(hiddenUntilNextLoop)}%{fill:${EMPTY_FILL}}${formatPercent(hiddenUntilNextLoop + EPSILON)}%,${formatPercent(visibleUntil)}%{fill:${originalFill}}${formatPercent(hiddenFrom)}%,100%{fill:${EMPTY_FILL}}}`;
    },
  );
}

function formatPercent(value) {
  return value.toFixed(2).replace(/\.?0+$/, "");
}
