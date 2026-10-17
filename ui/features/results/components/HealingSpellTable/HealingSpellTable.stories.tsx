import { HealingSpellStats } from '@generated/proto/api';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { HealingSpellTableView } from './HealingSpellTable';

const spells = [
	HealingSpellStats.create({
		id: { rawId: { oneofKind: 'spellId', spellId: 2061 }, tag: 0 },
		name: 'Flash Heal',
		rank: 7,
		min: 812,
		mean: 913.5,
		max: 1015,
		critMin: 1218,
		critMean: 1370.25,
		critMax: 1522.5,
	}),
	HealingSpellStats.create({
		id: { rawId: { oneofKind: 'spellId', spellId: 9473 }, tag: 0 },
		name: 'Flash Heal',
		rank: 6,
		min: 711,
		mean: 799,
		max: 887,
		critMin: 1066.5,
		critMean: 1198.5,
		critMax: 1330.5,
	}),
];

const meta = {
	title: 'Features/Results/HealingSpellTable',
	component: HealingSpellTableView,
	tags: ['autodocs'],
	args: { spells },
} satisfies Meta<typeof HealingSpellTableView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { spells: [] } };
