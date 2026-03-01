import fs from 'fs';

function toSignedDelta(value: number): -1 | 0 | 1 {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function analyze(filePath: string) {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const actions = content.actions;
    if (!actions || actions.length < 2) return null;

    const durationMs = actions[actions.length - 1].at - actions[0].at;
    const durationSec = durationMs / 1000;
    const points = actions.length;
    const pointRate = points / durationSec;

    let velocitySamples = 0;
    let velocitySum = 0;

    for (let index = 1; index < actions.length; index += 1) {
        const previous = actions[index - 1];
        const current = actions[index];
        const deltaTimeSec = (current.at - previous.at) / 1000;
        if (deltaTimeSec <= 0) continue;
        const deltaPos = Math.abs(current.pos - previous.pos);
        const velocity = deltaPos / deltaTimeSec;
        velocitySamples += 1;
        velocitySum += velocity;
    }

    const avgVelocity = velocitySum / velocitySamples;
    
    // Current difficulty calculation logic
    const pointNorm = Math.min(Math.max(Math.log1p(pointRate) / Math.log1p(8), 0), 1);
    const velocityNorm = Math.min(Math.max(Math.log1p(avgVelocity) / Math.log1p(400), 0), 1);
    const lengthNorm = Math.min(Math.max((durationSec / 60) / 3, 0), 1);
    const score = 0.55 * velocityNorm + 0.35 * pointNorm + 0.1 * lengthNorm;
    const difficulty = Math.min(Math.max(Math.round(1 + score * 4), 1), 5);

    return {
        file: filePath,
        durationSec,
        points,
        pointRate,
        avgVelocity,
        score,
        difficulty
    };
}

const files = process.argv.slice(2);
files.forEach(f => {
    try {
        console.log(JSON.stringify(analyze(f), null, 2));
    } catch (e) {
        console.error(`Error analyzing ${f}:`, e);
    }
});
