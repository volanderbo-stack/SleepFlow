import { scoreColor } from '../app/format';

interface Props {
  score: number;
  size?: number;
  stroke?: number;
  label?: string;
}

export function ScoreRing({ score, size = 120, stroke = 10, label }: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const small = size < 64;
  return (
    <div className="score-ring" style={{ width: size, height: size }} role="img" aria-label={`Оцінка сну ${score} зі 100`}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line-strong)" strokeWidth={stroke} fill="none" />
        <circle
          className="score-ring__arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={scoreColor(score)}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          style={{ ['--dash' as string]: `${c}`, ['--offset' as string]: `${c * (1 - score / 100)}` }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="score-ring__value">
        <span style={{ fontSize: small ? size * 0.34 : size * 0.3 }}>{score}</span>
        {label && !small && <small>{label}</small>}
      </div>
    </div>
  );
}
