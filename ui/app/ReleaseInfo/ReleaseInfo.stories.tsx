import type { Meta, StoryObj } from '@storybook/react-vite';

import { ReleaseInfo } from './ReleaseInfo';

const meta = {
	title: 'App/ReleaseInfo',
	component: ReleaseInfo,
	tags: ['autodocs'],
	parameters: { spec: 'none' },
	args: {
		info: { date: '2026-10-18', commit: '2fe052cd96a4b1f0e2d3c4b5a697887766554433', gameVersion: '1.60.1.70450' },
		className: 'text-xs text-secondary',
	},
} satisfies Meta<typeof ReleaseInfo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const OnTheLandingPage: Story = {
	args: { className: 'text-sm text-white/65' },
};

// A build that could not read its commit, such as one made from a source archive.
export const WithoutCommit: Story = {
	args: { info: { date: '2026-10-18', commit: '', gameVersion: '1.60.1.70450' } },
};
