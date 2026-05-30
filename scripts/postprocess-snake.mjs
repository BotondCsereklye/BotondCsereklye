import fs from "node:fs";
import path from "node:path";

const RESPAWN_DELAY_MS = 5 * 60 * 1000;
const EMPTY_FILL = "var(--ce)";
const CROPPED_VIEWBOX = 'viewBox="0 0 848 112" width="848" height="112"';
const GRID_STEP_PX = 16;
const MERGE_TOLERANCE_MS = 6;
const SERIALIZE_TOLERANCE_MS = 0.5;

const files = process.argv.slice(2);

if (files.length === 0) {
  console.error("Usage: node scripts/postprocess-snake.mjs <svg-file> [<svg-file>...]");
  process.exit(1);
}

for (const file of files) {
  const absolutePath = path.resolve(file);
  const originalSvg = fs.readFileSync(absolutePath, "utf8");
  const snakeLoopDurationMs = readSnakeLoopDuration(originalSvg);
  const commitTimelineDurationMs = leastCommonMultiple(snakeLoopDurationMs, RESPAWN_DELAY_MS);
  const fillByCommitClass = readCommitFillMap(originalSvg);
  const positionByCommitClass = readCommitPositionMap(originalSvg);
  const occupancyByCell = readSnakeOccupancyMap(originalSvg, snakeLoopDurationMs);

  let nextSvg = cropToContributionGrid(originalSvg);
  nextSvg = configureCommitAnimation(nextSvg, commitTimelineDurationMs);
  nextSvg = rewriteCommitKeyframes(
    nextSvg,
    commitTimelineDurationMs,
    snakeLoopDurationMs,
    fillByCommitClass,
    positionByCommitClass,
    occupancyByCell,
  );

  fs.writeFileSync(absolutePath, nextSvg);
}

function readSnakeLoopDuration(svg) {
  const durationMatch = svg.match(/\.s\{[^}]*animation:none[^}]*?([0-9.]+)ms[^}]*?infinite/);

  if (!durationMatch) {
    throw new Error("Could not find the snake animation duration in the SVG.");
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

function configureCommitAnimation(svg, commitTimelineDurationMs) {
  return svg.replace(
    /\.c\{([^}]*)animation:none\s+[0-9.]+ms\s+[^\s]+\s+infinite;([^}]*)\}/,
    `.c{$1animation-name:none;animation-duration:${commitTimelineDurationMs}ms;animation-timing-function:steps(1,end);animation-iteration-count:1;animation-fill-mode:both;$2}`,
  );
}

function rewriteCommitKeyframes(
  svg,
  commitTimelineDurationMs,
  snakeLoopDurationMs,
  fillByCommitClass,
  positionByCommitClass,
  occupancyByCell,
) {
  let nextSvg = svg;

  for (const [commitClass, originalFill] of fillByCommitClass.entries()) {
    const position = positionByCommitClass.get(commitClass);

    if (!position) {
      continue;
    }

    const occupancyIntervals = occupancyByCell.get(toCellKey(position.x, position.y)) ?? [];
    const hiddenIntervals = simulateHiddenIntervals(
      commitTimelineDurationMs,
      snakeLoopDurationMs,
      occupancyIntervals,
      RESPAWN_DELAY_MS,
    );
    const keyframeBody = serializeCommitKeyframes(hiddenIntervals, originalFill, commitTimelineDurationMs);

    nextSvg = replaceKeyframeBody(nextSvg, commitClass, keyframeBody);
  }

  return nextSvg;
}

function readSnakeOccupancyMap(svg, snakeLoopDurationMs) {
  const occupancyByCell = new Map();

  for (const segmentName of readSnakeSegmentNames(svg)) {
    const frames = expandSnakeFrames(parseSnakeFrames(svg, segmentName));
    const groups = groupConsecutiveFrames(frames);

    for (const occupancy of buildOccupancyWindows(groups)) {
      for (const normalized of normalizeLoopWindow(occupancy.start, occupancy.end, 100)) {
        const cellKey = toCellKey(occupancy.x, occupancy.y);

        if (!occupancyByCell.has(cellKey)) {
          occupancyByCell.set(cellKey, []);
        }

        occupancyByCell.get(cellKey).push({
          start: percentToMilliseconds(normalized.start, snakeLoopDurationMs),
          end: percentToMilliseconds(normalized.end, snakeLoopDurationMs),
        });
      }
    }
  }

  for (const [cellKey, intervals] of occupancyByCell.entries()) {
    occupancyByCell.set(cellKey, mergeIntervals(intervals, MERGE_TOLERANCE_MS));
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
    const stepCount = (Math.abs(deltaX) + Math.abs(deltaY)) / GRID_STEP_PX;

    if (stepCount === 0) {
      expandedFrames.push(currentFrame);
      continue;
    }

    const stepX = Math.sign(deltaX) * GRID_STEP_PX;
    const stepY = Math.sign(deltaY) * GRID_STEP_PX;

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

function buildOccupancyWindows(groups) {
  const windows = [];

  for (let index = 0; index < groups.length; index += 1) {
    const previous = index === 0
      ? shiftWindow(groups[groups.length - 1], -100)
      : groups[index - 1];
    const current = groups[index];
    const next = index === groups.length - 1
      ? shiftWindow(groups[0], 100)
      : groups[index + 1];

    windows.push({
      x: current.x,
      y: current.y,
      start: (previous.end + current.start) / 2,
      end: (current.end + next.start) / 2,
    });
  }

  return windows;
}

function shiftWindow(window, offset) {
  return {
    ...window,
    start: window.start + offset,
    end: window.end + offset,
  };
}

function normalizeLoopWindow(start, end, cycleSize) {
  if (end - start >= cycleSize) {
    return [{ start: 0, end: cycleSize }];
  }

  if (start < 0) {
    return [
      { start: 0, end },
      { start: cycleSize + start, end: cycleSize },
    ];
  }

  if (end > cycleSize) {
    return [
      { start, end: cycleSize },
      { start: 0, end: end - cycleSize },
    ];
  }

  return [{ start, end }];
}

function simulateHiddenIntervals(totalDurationMs, snakeLoopDurationMs, occupancyIntervals, respawnDelayMs) {
  const repeatedOccupancy = repeatIntervals(occupancyIntervals, totalDurationMs, snakeLoopDurationMs);
  const hiddenIntervals = [];
  let occupancyIndex = 0;
  let visibleFromMs = 0;

  while (visibleFromMs < totalDurationMs) {
    while (
      occupancyIndex < repeatedOccupancy.length &&
      repeatedOccupancy[occupancyIndex].end <= visibleFromMs + MERGE_TOLERANCE_MS
    ) {
      occupancyIndex += 1;
    }

    if (occupancyIndex >= repeatedOccupancy.length) {
      break;
    }

    if (visibleFromMs < repeatedOccupancy[occupancyIndex].start - MERGE_TOLERANCE_MS) {
      visibleFromMs = repeatedOccupancy[occupancyIndex].start;
    }

    if (visibleFromMs >= totalDurationMs) {
      break;
    }

    const hiddenStartMs = visibleFromMs;
    let visibleAgainMs = hiddenStartMs + respawnDelayMs;

    while (true) {
      while (
        occupancyIndex < repeatedOccupancy.length &&
        repeatedOccupancy[occupancyIndex].end <= visibleAgainMs + MERGE_TOLERANCE_MS
      ) {
        occupancyIndex += 1;
      }

      if (occupancyIndex >= repeatedOccupancy.length) {
        break;
      }

      const occupancy = repeatedOccupancy[occupancyIndex];

      if (
        occupancy.start <= visibleAgainMs + MERGE_TOLERANCE_MS &&
        visibleAgainMs < occupancy.end - MERGE_TOLERANCE_MS
      ) {
        visibleAgainMs += respawnDelayMs;
        continue;
      }

      break;
    }

    hiddenIntervals.push({
      start: hiddenStartMs,
      end: Math.min(visibleAgainMs, totalDurationMs),
    });

    visibleFromMs = visibleAgainMs;
  }

  return mergeIntervals(hiddenIntervals, MERGE_TOLERANCE_MS);
}

function repeatIntervals(intervals, totalDurationMs, snakeLoopDurationMs) {
  const repeated = [];
  const loopCount = Math.ceil(totalDurationMs / snakeLoopDurationMs);

  for (let loopIndex = 0; loopIndex < loopCount; loopIndex += 1) {
    const offset = loopIndex * snakeLoopDurationMs;

    for (const interval of intervals) {
      const start = interval.start + offset;

      if (start >= totalDurationMs) {
        break;
      }

      repeated.push({
        start,
        end: Math.min(interval.end + offset, totalDurationMs),
      });
    }
  }

  return repeated;
}

function mergeIntervals(intervals, toleranceMs) {
  const normalized = intervals
    .filter((interval) => interval.end - interval.start > toleranceMs)
    .sort((left, right) => left.start - right.start);

  if (normalized.length === 0) {
    return [];
  }

  const merged = [normalized[0]];

  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index];
    const previous = merged[merged.length - 1];

    if (current.start <= previous.end + toleranceMs) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }

    merged.push(current);
  }

  return merged;
}

function serializeCommitKeyframes(hiddenIntervals, originalFill, totalDurationMs) {
  const segments = [];
  let cursorMs = 0;

  for (const interval of hiddenIntervals) {
    if (interval.start > cursorMs + SERIALIZE_TOLERANCE_MS) {
      segments.push({
        start: cursorMs,
        end: interval.start,
        fill: originalFill,
      });
    }

    segments.push({
      start: Math.max(cursorMs, interval.start),
      end: interval.end,
      fill: EMPTY_FILL,
    });

    cursorMs = interval.end;
  }

  if (cursorMs < totalDurationMs - SERIALIZE_TOLERANCE_MS) {
    segments.push({
      start: cursorMs,
      end: totalDurationMs,
      fill: originalFill,
    });
  }

  if (segments.length === 0) {
    segments.push({
      start: 0,
      end: totalDurationMs,
      fill: originalFill,
    });
  }

  return segments
    .map((segment) => `${formatPercent(segment.start, totalDurationMs)}%,${formatPercent(segment.end, totalDurationMs)}%{fill:${segment.fill}}`)
    .join("");
}

function replaceKeyframeBody(svg, animationName, keyframeBody) {
  const startToken = `@keyframes ${animationName}{`;
  const endToken = `}.c.${animationName}{`;
  const startIndex = svg.indexOf(startToken);
  const endIndex = svg.indexOf(endToken, startIndex);

  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Could not replace keyframes for ${animationName}.`);
  }

  return `${svg.slice(0, startIndex + startToken.length)}${keyframeBody}${svg.slice(endIndex)}`;
}

function percentToMilliseconds(percent, totalDurationMs) {
  return (percent / 100) * totalDurationMs;
}

function formatPercent(milliseconds, totalDurationMs) {
  return ((milliseconds / totalDurationMs) * 100).toFixed(6).replace(/\.?0+$/, "");
}

function toCellKey(x, y) {
  return `${x},${y}`;
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));

  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a;
}

function leastCommonMultiple(left, right) {
  return Math.abs(left * right) / greatestCommonDivisor(left, right);
}
