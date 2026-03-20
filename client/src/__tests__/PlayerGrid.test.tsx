import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PlayerGrid from '../components/PlayerGrid';

const players = [
  { id: 'p1', name: 'Player1', role: 'villager', alive: true, type: 'human' as const },
  { id: 'p2', name: 'Player2', role: 'werewolf', alive: true, type: 'ai' as const },
  { id: 'p3', name: 'Player3', role: 'seer', alive: true, type: 'human' as const },
];

describe('PlayerGrid PK投票目标限制', () => {
  it('pk_voting阶段只有pkCandidates可被选择', () => {
    const onSelect = vi.fn();
    render(
      <PlayerGrid
        players={players}
        myPlayerId="p3"
        selectedTarget={null}
        onSelectTarget={onSelect}
        phase="pk_voting"
        deaths={[]}
        pkCandidates={['p1', 'p2']}
      />
    );
    // Click on p1 (candidate) - should be selectable
    fireEvent.click(screen.getByText('Player1'));
    expect(onSelect).toHaveBeenCalledWith('p1');
  });

  it('pk_voting阶段候选人自己不能投票', () => {
    const onSelect = vi.fn();
    render(
      <PlayerGrid
        players={players}
        myPlayerId="p1"
        selectedTarget={null}
        onSelectTarget={onSelect}
        phase="pk_voting"
        deaths={[]}
        pkCandidates={['p1', 'p2']}
      />
    );
    // Click on p2 (other candidate) - p1 is candidate so can't vote
    fireEvent.click(screen.getByText('Player2'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('voting阶段所有存活非自己玩家可被选择', () => {
    const onSelect = vi.fn();
    render(
      <PlayerGrid
        players={players}
        myPlayerId="p1"
        selectedTarget={null}
        onSelectTarget={onSelect}
        phase="voting"
        deaths={[]}
        pkCandidates={[]}
      />
    );
    fireEvent.click(screen.getByText('Player2'));
    expect(onSelect).toHaveBeenCalledWith('p2');
  });
});
