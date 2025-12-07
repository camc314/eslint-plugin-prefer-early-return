import { definePlugin } from 'oxlint';
import { preferEarlyReturnRule } from './prefer-early-return';

export const plugin = definePlugin({
    meta: {
        name: 'eslint-plugin-prefer-early-return',
    },
    rules: {
        'prefer-early-return': preferEarlyReturnRule,
    },
});

export { preferEarlyReturnRule };
