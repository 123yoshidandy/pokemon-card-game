import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
    test: {
        // CPU は先読みするので、CPU 同士の試合を何十も回すテストは、遅い CI で数十秒かかる
        testTimeout: 60000,
        // 作業用のコピー（worktree）のテストは数えない
        exclude: [...configDefaults.exclude, '.claude/**']
    }
});
