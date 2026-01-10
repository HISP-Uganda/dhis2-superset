/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import React, { useState, useEffect } from 'react';
import { styled, t } from '@superset-ui/core';

interface AnimationControlsProps {
  periods: string[];
  onPeriodChange: (period: string, index: number) => void;
  autoPlay?: boolean;
  speed?: number;
}

const ControlsContainer = styled.div`
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.95);
  padding: 10px;
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  z-index: 999;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 300px;
  backdrop-filter: blur(2px);
`;

const Button = styled.button`
  background: #1890ff;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;

  &:hover {
    background: #0050b3;
  }

  &:disabled {
    background: #d9d9d9;
    cursor: not-allowed;
  }
`;

const Slider = styled.input`
  flex: 1;
  height: 4px;
  cursor: pointer;
`;

const TimeLabel = styled.span`
  font-size: 12px;
  font-weight: 500;
  min-width: 60px;
`;

const SpeedControl = styled.input`
  width: 60px;
  height: 24px;
  cursor: pointer;
`;

function AnimationControls({
  periods,
  onPeriodChange,
  autoPlay: initialAutoPlay = false,
  speed: initialSpeed = 1000,
}: AnimationControlsProps): React.ReactElement | null {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(initialAutoPlay);
  const [speed, setSpeed] = useState(initialSpeed);

  useEffect(() => {
    if (!isPlaying || periods.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      setCurrentIndex(prev => {
        const nextIndex = (prev + 1) % periods.length;
        onPeriodChange(periods[nextIndex], nextIndex);
        return nextIndex;
      });
    }, speed);

    return () => clearInterval(interval);
  }, [isPlaying, speed, periods, onPeriodChange]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newIndex = parseInt(e.target.value, 10);
    setCurrentIndex(newIndex);
    onPeriodChange(periods[newIndex], newIndex);
  };

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handlePrevious = () => {
    const newIndex = (currentIndex - 1 + periods.length) % periods.length;
    setCurrentIndex(newIndex);
    onPeriodChange(periods[newIndex], newIndex);
  };

  const handleNext = () => {
    const newIndex = (currentIndex + 1) % periods.length;
    setCurrentIndex(newIndex);
    onPeriodChange(periods[newIndex], newIndex);
  };

  const handleSpeedChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSpeed(parseInt(e.target.value, 10));
  };

  if (periods.length === 0) {
    return null;
  }

  return (
    <ControlsContainer>
      <Button onClick={handlePrevious} disabled={periods.length === 1}>
        ◄
      </Button>
      <Button onClick={handlePlayPause}>{isPlaying ? '⏸' : '▶'}</Button>
      <Button onClick={handleNext} disabled={periods.length === 1}>
        ►
      </Button>
      <Slider
        type="range"
        min={0}
        max={periods.length - 1}
        value={currentIndex}
        onChange={handleSliderChange}
      />
      <TimeLabel>{periods[currentIndex]}</TimeLabel>
      <label title={t('Speed (ms)')}>
        <SpeedControl
          type="range"
          min={200}
          max={3000}
          step={100}
          value={speed}
          onChange={handleSpeedChange}
        />
      </label>
    </ControlsContainer>
  );
};

export default AnimationControls;
