/**
 * 升级版本的 AST 提取器
 * src/extractors/advancedAstExtractor.ts
 */

import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { encryptData } from '../utils/crypto';

export interface XIsHumanResponse {
    b: number;
    v: number;
    e: string;
    s: string;
    d: number;
    vr: string;
}

/**
 * 评估表达式的值
 */
function evaluateExpression(node: t.Expression): number | null {
    if (t.isNumericLiteral(node)) {
        return node.value;
    }
    
    if (t.isBinaryExpression(node)) {
        const left = evaluateExpression(node.left);
        const right = evaluateExpression(node.right);
        
        if (left === null || right === null) return null;
        
        switch (node.operator) {
            case '+': return left + right;
            case '-': return left - right;
            case '*': return left * right;
            case '/': return left / right;
            case '%': return left % right;
            case '**': return Math.pow(left, right);
            case '>>': return left >> right;
            case '<<': return left << right;
            case '>>>': return left >>> right;
            case '|': return left | right;
            case '&': return left & right;
            case '^': return left ^ right;
            default: return null;
        }
    }
    
    if (t.isUnaryExpression(node)) {
        const arg = evaluateExpression(node.argument);
        if (arg === null) return null;
        
        switch (node.operator) {
            case '+': return +arg;
            case '-': return -arg;
            case '~': return ~arg;
            default: return null;
        }
    }
    
    return null;
}

export async function extractBotIDxIsHuman(ast: t.File): Promise<XIsHumanResponse> {
    const targetValues = {
        specificNumber: null as number | null,
        jwtToken: null as string | null,
        objectPropertyS: null as { key: string; value: number } | null,
        passwordVariables: null as { var1: string; var2: string; password: string } | null,
    };

    const stringAssignments = new Map<string, string>();
    const variableConcatenations: Array<{ left: string; right: string }> = [];

    traverse(ast, {
        // 提取 CallExpression - 支持更复杂的参数
        CallExpression(path) {
            const callee = path.node.callee;
            const args = path.node.arguments;

            if (callee.type === 'Identifier' && callee.name === 'X' && args.length === 5) {
                // 处理第 3 个参数 (v 值) - 可能是表达式
                const thirdArg = args[2];
                const numValue = evaluateExpression(thirdArg as t.Expression);
                
                if (numValue !== null) {
                    targetValues.specificNumber = numValue;
                    console.log(`✅ 找到 v 值: ${numValue}`);
                }

                // 处理第 4 个参数 (JWT Token)
                if (args[3].type === 'StringLiteral' && args[3].value.startsWith('eyJ')) {
                    targetValues.jwtToken = args[3].value;
                    console.log(`✅ 找到 JWT Token: ${args[3].value.substring(0, 50)}...`);
                }
            }

            // 备用：查找其他包含 JWT 的函数调用
            for (let i = 0; i < args.length; i++) {
                const arg = args[i] as any;
                if (
                    arg.type === 'StringLiteral' &&
                    arg.value.startsWith('eyJ') &&
                    arg.value.includes('.') &&
                    !targetValues.jwtToken
                ) {
                    targetValues.jwtToken = arg.value;
                    console.log(`✅ 找到 JWT Token(备用): ${arg.value.substring(0, 50)}...`);

                    // 查找前面的数字参数
                    if (i > 0) {
                        const prevArg = args[i - 1] as t.Expression;
                        const prevValue = evaluateExpression(prevArg);
                        
                        if (prevValue !== null && !targetValues.specificNumber) {
                            targetValues.specificNumber = prevValue;
                            console.log(`✅ 找到 v 值(前置参数): ${prevValue}`);
                        }
                    }
                }
            }
        },

        // 提取对象属性 S
        ObjectProperty(path) {
            if (path.node.key && path.node.value) {
                let keyName = '';
                if (path.node.key.type === 'StringLiteral') {
                    keyName = path.node.key.value;
                } else if (path.node.key.type === 'Identifier') {
                    keyName = path.node.key.name;
                }

                if (keyName === 'S') {
                    const value = evaluateExpression(path.node.value as t.Expression);
                    
                    if (value !== null) {
                        targetValues.objectPropertyS = { key: keyName, value };
                        console.log(`✅ 找到对象属性 S: ${value}`);
                    }
                }
            }
        },

        // 提取字符串赋值
        AssignmentExpression(path) {
            if (
                path.node.left.type === 'Identifier' &&
                path.node.right.type === 'StringLiteral'
            ) {
                const varName = path.node.left.name;
                const varValue = path.node.right.value;

                if (varValue && varValue.trim() !== '') {
                    stringAssignments.set(varName, varValue);
                    console.log(`🔍 发现字符串赋值: ${varName} = "${varValue}"`);
                }
            }
        },

        // 提取二元表达式 (字符串拼接)
        BinaryExpression(path) {
            if (
                path.node.operator === '+' &&
                path.node.left.type === 'Identifier' &&
                path.node.right.type === 'Identifier'
            ) {
                const leftVar = path.node.left.name;
                const rightVar = path.node.right.name;
                variableConcatenations.push({ left: leftVar, right: rightVar });
                console.log(`🔗 发现变量连接: ${leftVar} + ${rightVar}`);
            }
        }
    });

    // 分析变量连接模式找到密码
    console.log('\n=== 分析变量连接模式 ===');
    for (const concat of variableConcatenations) {
        const leftValue = stringAssignments.get(concat.left);
        const rightValue = stringAssignments.get(concat.right);

        if (leftValue && rightValue) {
            console.log(`✅ 找到密码变量对: ${concat.left}="${leftValue}" + ${concat.right}="${rightValue}"`);
            const password = leftValue + rightValue;

            targetValues.passwordVariables = {
                var1: leftValue,
                var2: rightValue,
                password: password
            };
            break;
        }
    }

    // 验证所有必需的值
    if (!targetValues.specificNumber) {
        throw new Error('v 值未找到');
    }

    if (!targetValues.jwtToken) {
        throw new Error('JWT Token 未找到');
    }

    if (!targetValues.objectPropertyS) {
        throw new Error('对象属性 S 未找到');
    }

    if (!targetValues.passwordVariables) {
        throw new Error('密码变量对未找到');
    }

    // 输出提取的结果
    console.log('\n=== 目标值提取结果 ===');
    console.log('v 值:', targetValues.specificNumber);
    console.log('对象属性 S:', targetValues.objectPropertyS);
    console.log('密码变量:', targetValues.passwordVariables);
    console.log('JWT Token:', targetValues.jwtToken ? '已找到' : '未找到');

    // 构建加密对象
    const encryptionPayload = {
        p: false,
        S: targetValues.objectPropertyS.value,
        w: {
            v: 'Google Inc. (Apple)',
            r: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)'
        },
        s: false,
        h: false,
        b: false,
        d: false
    };

    const password = targetValues.passwordVariables.password;
    console.log(`\n加密密码: ${password}`);

    // 加密数据
    const encryptedData = await encryptData(password, encryptionPayload);
    console.log('加密后的数据:', encryptedData);

    return {
        b: 0,
        v: targetValues.specificNumber,
        e: targetValues.jwtToken,
        s: encryptedData,
        d: 0,
        vr: '3'
    };
}
