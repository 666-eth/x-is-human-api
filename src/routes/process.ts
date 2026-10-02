/**
 * 升级后的处理路由
 * src/routes/process.ts
 */

import { Router, Request, Response } from 'express';
import { AdvancedDeobfuscator } from '../deobfuscator/advanced-deobfuscator';
import { extractBotIDxIsHuman } from '../extractors/advancedAstExtractor';
import { parse } from '@babel/parser';

const router = Router();

router.post('/process', async (req: Request, res: Response) => {
    try {
        const { jsCode } = req.body;

        if (!jsCode) {
            return res.status(400).json({
                success: false,
                error: '请提供 jsCode 参数'
            });
        }

        // 检查文件大小（放宽到 100KB）
        const jsCodeSize = Buffer.byteLength(jsCode, 'utf8');
        if (jsCodeSize > 100 * 1024) {
            return res.status(400).json({
                success: false,
                error: `jsCode 超过大小限制，最大允许 100KB，当前 ${(jsCodeSize / 1024).toFixed(2)}KB`
            });
        }

        console.log(`\n开始处理代码，大小: ${jsCodeSize / 1024:.2f} KB`);

        // 1. 高级反混淆
        console.log('Step 1: 执行高级反混淆...');
        const deobfuscator = new AdvancedDeobfuscator(jsCode);
        const deobfuscatedCode = deobfuscator.deobfuscate();

        console.log('✅ 反混淆完成');

        // 2. 解析 AST
        console.log('Step 2: 解析 AST...');
        const ast = parse(deobfuscatedCode, {
            sourceType: 'module',
            allowImportExportEverywhere: true,
            allowReturnOutsideFunction: true
        });

        console.log('✅ AST 解析完成');

        // 3. 提取数据并生成 x-is-human
        console.log('Step 3: 提取数据...');
        const xIsHuman = await extractBotIDxIsHuman(ast);

        console.log('✅ 数据提取完成');

        res.json({
            success: true,
            data: xIsHuman
        });

    } catch (error: any) {
        console.error('处理失败:', error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

/**
 * 健康检查
 */
router.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'ok',
        service: 'x-is-human-api-advanced',
        version: '2.0.0',
        time: new Date().toISOString()
    });
});

export default router;
