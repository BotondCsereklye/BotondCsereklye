import fs from "node:fs";
import path from "node:path";

const RESPAWN_DELAY_MS = 5000;
const EMPTY_FILL = "var(--ce)";
const CROPPED_VIEWBOX = 'viewBox="0 0 848 112" width="848" height="112"';
const MERGE_TOLERANCE = 0.02;

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
  const positionByCommitClass = readCommitPositionMap(originalSvg);
  const occupancyByCell = readSnakeOccupancyMap(originalSvg);

  let nextSvg = cropToContributionGrid(originalSvg);
  nextSvg = useStepTimingForCommitAnimations(nextSvg);
  nextSvg = addRespawnAnimation(nextSvg, durationMs, fillByCommitClass, positionByCommitClass, occupancyByCell);

  fs.writeFileSync(absolutePath, nextSvg);
}

function readAnimationDuration(svg) {
  const durationMatch = svg.match(/\.c\{[^}]*animation:none\s+([0-9.]+)ms\s+[^\s]+\s+infinite/);

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

function readCommitPositionMap(svg) {
  const positionByCommitClass = new Map();
  const positionPattern = /<rect class="c (c[0-9a-z]+)" x="([0-9.]+)" y="([0-9.]+)"/g;

  for (const match of svg.matchAll(positionPattern)) {
    positionByCommitClass.set(match[1], {
      x: Number(match[2]) - 2,
      y: Number(match[3]) - 2,
    });
  }

  return positionByCommitClass;
}

function cropToContributionGrid(svg) {
  return svg.replace(/viewBox="[^"]+"\s+width="[^"]+"\s+height="[^"]+"/, CROPPED_VIEWBOX);
}

function useStepTimingForCommitAnimations(svg) {
  return svg.replace(
    /\.c\{([^}]*)animation:none\s+([0-9.]+)ms\s+[^\s]+\s+infinite([^}]*)\}/,
    ".c{$1animation:none $2ms steps(1,end) infinite$3}",
  );
}

function addRespawnAnimation(svg, durationMs, fillByCommitClass, positionByCommitClass, occupancyByCell) {
  const respawnDelayPercent = (RESPAWN_DELAY_MS / durationMs) * 100;
  const keyframePattern = /@keyframes (c[0-9a-z]+)\{([0-9.]+)%\{fill:[^}]+\}([0-9.]+)%,100%\{fill:var\(--ce\)\}\}/g;

  return svg.replace(
    keyframePattern,
    (fullMatch, animationName, _visibleUntil, hiddenFrom) => {
      const originalFill = fillByCommitClass.get(animationName);
      const position = positionByCommitClass.get(animationName);

      if (!originalFill || !position) {
        return fullMatch;
      }

      const hiddenIntervals = buildHiddenIntervals(
        Number(hiddenFrom),
        respawnDelayPercent,
        position,
        occupancyByCell,
      );

      return serializeCommitKeyframes(animationName, originalFill, hiddenIntervals);
    },
  );
}

function buildHiddenIntervals(hiddenFrom, respawnDelayPercent, position, occupancyByCell) {
  const hiddenIntervals = normalizeLoopInterval(hiddenFrom, hiddenFrom + respawnDelayPercent);
  const cellKey = toCellKey(position.x, position.y);

  for (const occupancy of occupancyByCell.get(cellKey) ?? []) {
    hiddenIntervals.push(...normalizeLoopInterval(occupancy.start, occupancy.end));
  }

  return mergeIntervals(hiddenIntervals);
}

function normalizeLoopInterval(start, end) {
  if (end - start >= 100) {
    return [{ start: 0, end: 100 }];
  }

  if (start < 0) {
    return [
      { start: 0, end },
      { start: 100 + start, end: 100 },
    ];
  }

  if (end > 100) {
    return [
      { start, end: 100 },
      { start: 0, end: end - 100 },
    ];
  }

  return [{ start, end }];
}

function mergeIntervals(intervals) {
  const normalized = intervals
    .map((interval) => ({
      start: clampPercent(interval.start),
      end: clampPercent(interval.end),
    }))
    .filter((interval) => interval.end - interval.start > MERGE_TOLERANCE)
    .sort((left, right) => left.start - right.start);

  if (normalized.length === 0) {
    return [];
  }

  const merged = [normalized[0]];

  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index];
    const previous = merged[merged.length - 1];

    if (current.start <= previous.end + MERGE_TOLERANCE) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }

    merged.push(current);
  }

  return merged;
}

function serializeCommitKeyframes(animationName, originalFill, hiddenIntervals) {
  const segments = [];
  let cursor = 0;

  for (const interval of hiddenIntervals) {
    if (interval.start > cursor + MERGE_TOLERANCE) {
      segments.push({
        start: cursor,
        end: interval.start,
        fill: originalFill,
      });
    }

    segments.push({
      start: Math.max(cursor, interval.start),
      end: interval.end,
      fill: EMPTY_FILL,
    });

    cursor = interval.end;
  }

  if (cursor < 100 - MERGE_TOLERANCE) {
    segments.push({
      start: cursor,
      end: 100,
      fill: originalFill,
    });
  }

  return `@keyframes ${animationName}{${segments
    .map((segment) => `${formatPercent(segment.start)}%,${formatPercent(segment.end)}%{fill:${segment.fill}}`)
    .join("")}}`;
}

function readSnakeOccupancyMap(svg) {
  const occupancyByCell = new Map();

  for (const segmentName of readSnakeSegmentNames(svg)) {
    const frames = expandSnakeFrames(parseSnakeFrames(svg, segmentName));
    const positionGroups = groupConsecutiveFrames(frames);

    for (const occupancy of buildOccupancyIntervals(positionGroups)) {
      const cellKey = toCellKey(occupancy.x, occupancy.y);

      if (!occupancyByCell.has(cellKey)) {
        occupancyByCell.set(cellKey, []);
      }

      occupancyByCell.get(cellKey).push(occupancy);
    }
  }

  return occupancyByCell;
}

function readSnakeSegmentNames(svg) {
  return [...svg.matchAll(/\.s\.(s[0-9a-z]+)\{transform:/g)].map((match) => match[1]);
}

function parseSnakeFrames(svg, segmentName) {
  const body = extractKeyframeBody(svg, segmentName, `}.s.${segmentName}{`);
  const frames = [];
  const framePattern = /([0-9.,%]+)\{transform:translate\((-?[0-9.]+)px,(-?[0-9.]+)px\)\}/g;

  for (const match of body.matchAll(framePattern)) {
    for (const percent of match[1].split(",")) {
      frames.push({
        percent: Number(percent.replace("%", "")),
        x: Number(match[2]),
        y: Number(match[3]),
      });
    }
  }

  return frames.sort((left, right) => left.percent - right.percent);
}

function expandSnakeFrames(frames) {
  const expandedFrames = [frames[0]];

  for (let index = 1; index < frames.length; index += 1) {
    const previousFrame = frames[index - 1];
    const currentFrame = frames[index];
    const deltaX = currentFrame.x - previousFrame.x;
    const deltaY = currentFrame.y - previousFrame.y;
    const stepCount = (Math.abs(deltaX) + Math.abs(deltaY)) / 16;

    if (stepCount === 0) {
      expandedFrames.push(currentFrame);
      continue;
    }

    const stepX = Math.sign(deltaX) * 16;
    const stepY = Math.sign(deltaY) * 16;

    for (let step = 1; step <= stepCount; step += 1) {
      expandedFrames.push({
        percent: previousFrame.percent + ((currentFrame.percent - previousFrame.percent) * step) / stepCount,
        x: previousFrame.x + stepX * step,
        y: previousFrame.y + stepY * step,
      });
    }
  }

  return expandedFrames;
}

function extractKeyframeBody(svg, animationName, endToken) {
  const startToken = `@keyframes ${animationName}{`;
  const startIndex = svg.indexOf(startToken);
  const endIndex = svg.indexOf(endToken, startIndex);

  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Could not extract keyframes for ${animationName}.`);
  }

  return svg.slice(startIndex + startToken.length, endIndex);
}

function groupConsecutiveFrames(frames) {
  const groups = [];

  for (const frame of frames) {
    const previousGroup = groups[groups.length - 1];

    if (previousGroup && previousGroup.x === frame.x && previousGroup.y === frame.y) {
      previousGroup.end = frame.percent;
      continue;
    }

    groups.push({
      x: frame.x,
      y: frame.y,
      start: frame.percent,
      end: frame.percent,
    });
  }

  return groups;
}

function buildOccupancyIntervals(groups) {
  const intervals = [];

  for (let index = 0; index < groups.length; index += 1) {
    const previous = index === 0
      ? shiftGroup(groups[groups.length - 1], -100)
      : groups[index - 1];
    const current = groups[index];
    const next = index === groups.length - 1
      ? shiftGroup(groups[0], 100)
      : groups[index + 1];

    intervals.push({
      x: current.x,
      y: current.y,
      start: (previous.end + current.start) / 2,
      end: (current.end + next.start) / 2,
    });
  }

  return intervals;
}

function shiftGroup(group, offset) {
  return {
    ...group,
    start: group.start + offset,
    end: group.end + offset,
  };
}

function toCellKey(x, y) {
  return `${x},${y}`;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

function formatPercent(value) {
  return value.toFixed(2).replace(/\.?0+$/, "");
}
