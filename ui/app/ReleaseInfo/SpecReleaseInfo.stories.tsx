import type { Meta, StoryObj } from '@storybook/react-vite';

import { SpecReleaseInfo } from './SpecReleaseInfo';

const meta = {
	title: 'App/SpecReleaseInfo',
	component: SpecReleaseInfo,
	tags: ['autodocs'],
	parameters: { spec: 'none' },
	args: {
		info: { date: '2026-10-18', commit: '2fe052cd96a4b1f0e2d3c4b5a697887766554433', gameVersion: '1.60.1.70450' },
		specName: 'Feral Cat',
		specVersion: { commit: '8109a4ce0d1e2f3a4b5c6d7e8f90a1b2c3d4e5f6', date: '2026-10-17' },
		className: 'border-t border-border px-sidebar py-2 text-xs text-white/65',
	},
} satisfies Meta<typeof SpecReleaseInfo>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// A build from a shallow clone reads no spec's last change.
export const WithoutSpecVersion: Story = {
	args: { specVersion: undefined },
};
