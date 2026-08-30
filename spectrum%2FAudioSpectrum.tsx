import React, { useRef, useEffect, useState } from 'react';

const AudioSpectrum: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 频谱数据
    const bars = 64;
    const data = new Array(bars).fill(0);
    const targetData = new Array(bars).fill(0);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 生成随机频谱
      if (isPlaying) {
        for (let i = 0; i < bars; i++) {
          targetData[i] = Math.random() * 80 + 10;
        }
      } else {
        // 静止时缓慢衰减
        for (let i = 0; i < bars; i++) {
          targetData[i] = Math.random() * 15 + 5;
        }
      }

      // 平滑过渡
      for (let i = 0; i < bars; i++) {
        data[i] += (targetData[i] - data[i]) * 0.15;
      }

      const barWidth = canvas.width / bars;
      const gap = 1;

      for (let i = 0; i < bars; i++) {
        const barHeight = data[i];
        const hue = (i / bars) * 60 + 200; // 蓝紫色调
        ctx.fillStyle = `hsl(${hue}, 70%, 60%)`;
        ctx.fillRect(
          i * (barWidth + gap) + gap / 2,
          canvas.height - barHeight,
          barWidth - gap,
          barHeight
        );
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying]);

  return (
    <div className="bg-gray-800 rounded-lg p-3 h-[calc(100%-12px)]">
      <h2 className="text-sm font-bold text-white mb-3">音频频谱</h2>
      <canvas
        ref={canvasRef}
        width={300}
        height={200}
        className="w-full h-full bg-gray-900 rounded"
      />
    </div>
  );
};

export default AudioSpectrum;
