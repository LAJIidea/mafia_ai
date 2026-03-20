import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Tutorial from '../pages/Tutorial';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderTutorial() {
  return render(
    <MemoryRouter>
      <Tutorial />
    </MemoryRouter>
  );
}

describe('Tutorial 交互式教程', () => {
  it('初始显示第一步', () => {
    renderTutorial();
    expect(screen.getByText('欢迎来到狼人杀')).toBeInTheDocument();
  });

  it('未完成当前步骤时点击下一步被阻止', () => {
    renderTutorial();
    const nextBtn = screen.getByText('下一步');
    fireEvent.click(nextBtn);
    // Should show block message
    expect(screen.getByText('请先完成当前步骤的操作才能继续')).toBeInTheDocument();
    // Should still be on step 1
    expect(screen.getByText('欢迎来到狼人杀')).toBeInTheDocument();
  });

  it('跳过教程按钮被拦截', () => {
    renderTutorial();
    const skipBtn = screen.getByText('跳过教程');
    fireEvent.click(skipBtn);
    expect(screen.getByText('请先完成当前步骤的操作才能继续')).toBeInTheDocument();
    // Should NOT navigate away
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('完成步骤后可以进入下一步', () => {
    renderTutorial();
    // Step 1: click "我准备好了"
    fireEvent.click(screen.getByText('我准备好了'));
    // Now click next
    fireEvent.click(screen.getByText('下一步'));
    // Should be on step 2
    expect(screen.getByText('模拟：身份分配')).toBeInTheDocument();
  });

  it('选择错误选项显示反馈', () => {
    renderTutorial();
    // Complete step 1
    fireEvent.click(screen.getByText('我准备好了'));
    fireEvent.click(screen.getByText('下一步'));
    // Step 2: select wrong answer
    fireEvent.click(screen.getByText('玩家A'));
    expect(screen.getByText('请再想想，选择更合适的选项。')).toBeInTheDocument();
  });
});
