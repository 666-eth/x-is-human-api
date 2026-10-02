/**
 * 升级版本的反混淆器 - 支持更复杂的混淆代码
 * src/deobfuscator/advanced-deobfuscator.ts
 */

import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import generate from '@babel/generator';

export class AdvancedDeobfuscator {
    private ast: t.File;
    
    constructor(source: string) {
        this.ast = parse(source, {
            sourceType: 'module',
            allowImportExportEverywhere: true,
            allowReturnOutsideFunction: true,
            plugins: [
                'jsx',
                'typescript',
                'classFields',
                'decorators-legacy',
                'dynamicImport',
                'logicalAssignment',
                'partialApplication',
                ['pipelineOperator', { proposal: 'minimal' }],
                'optionalCatchBinding',
                ['recordAndTuple', { syntaxType: 'bar' }],
                'topLevelAwait',
            ]
        });
    }

    /**
     * 执行完整的反混淆过程
     */
    public deobfuscate(): string {
        // Step 1: 简化字符串数组
        this.simplifyStringArrays();
        
        // Step 2: 内联变量
        this.inlineVariables();
        
        // Step 3: 简化控制流
        this.simplifyControlFlow();
        
        // Step 4: 提取数值表达式
        this.evaluateExpressions();
        
        // Step 5: 清理冗余代码
        this.cleanupRedundantCode();
        
        const { code } = generate(this.ast, {
            compact: false,
            comments: true,
        });
        
        return code;
    }

    /**
     * Step 1: 简化字符串数组编码
     * 处理形如: const AA=['str1','str2',...]; 的数组
     */
    private simplifyStringArrays(): void {
        const stringArrayMap = new Map<string, string[]>();
        
        traverse(this.ast, {
            VariableDeclaration: (path) => {
                const { declarations } = path.node;
                
                for (const decl of declarations) {
                    if (
                        t.isIdentifier(decl.id) &&
                        t.isArrayExpression(decl.init)
                    ) {
                        const arrayName = decl.id.name;
                        const strings: string[] = [];
                        
                        // 提取数组中的所有字符串
                        for (const element of (decl.init as t.ArrayExpression).elements) {
                            if (t.isStringLiteral(element)) {
                                strings.push(element.value);
                            }
                        }
                        
                        if (strings.length > 0) {
                            stringArrayMap.set(arrayName, strings);
                        }
                    }
                }
            }
        });
        
        // 替换字符串数组访问为实际值
        traverse(this.ast, {
            MemberExpression: (path) => {
                const { object, property } = path.node;
                
                if (
                    t.isIdentifier(object) &&
                    stringArrayMap.has(object.name) &&
                    (t.isNumericLiteral(property) || t.isStringLiteral(property))
                ) {
                    const strings = stringArrayMap.get(object.name)!;
                    const index = t.isNumericLiteral(property)
                        ? property.value
                        : parseInt(property.value);
                    
                    if (index >= 0 && index < strings.length) {
                        path.replaceWith(t.stringLiteral(strings[index]));
                    }
                }
            }
        });
    }

    /**
     * Step 2: 内联简单变量
     * 处理: const x = 'value'; 然后替换所有 x 为 'value'
     */
    private inlineVariables(): void {
        const variableValues = new Map<string, t.Expression>();
        
        // 第一次遍历：收集所有简单的变量赋值
        traverse(this.ast, {
            VariableDeclarator: (path) => {
                const { id, init } = path.node;
                
                if (
                    t.isIdentifier(id) &&
                    init &&
                    (t.isStringLiteral(init) || 
                     t.isNumericLiteral(init) ||
                     t.isBooleanLiteral(init))
                ) {
                    variableValues.set(id.name, init);
                }
            }
        });
        
        // 第二次遍历：替换变量使用
        traverse(this.ast, {
            Identifier: (path) => {
                const { name } = path.node;
                
                if (variableValues.has(name) && path.isReferencedIdentifier()) {
                    const value = variableValues.get(name)!;
                    path.replaceWith(t.cloneNode(value));
                }
            }
        });
    }

    /**
     * Step 3: 简化控制流
     * 移除无用的 if/else、循环等
     */
    private simplifyControlFlow(): void {
        traverse(this.ast, {
            IfStatement: (path) => {
                const { test, consequent, alternate } = path.node;
                
                // 如果 test 是常量，移除不必要的分支
                if (t.isBooleanLiteral(test)) {
                    if (test.value) {
                        path.replaceWith(consequent);
                    } else if (alternate) {
                        path.replaceWith(alternate);
                    } else {
                        path.remove();
                    }
                }
            },
            
            WhileStatement: (path) => {
                const { test } = path.node;
                
                // 移除 while(false) 循环
                if (t.isBooleanLiteral(test) && !test.value) {
                    path.remove();
                }
            },
            
            DoWhileStatement: (path) => {
                const { test } = path.node;
                
                // 移除 do...while(false) 循环
                if (t.isBooleanLiteral(test) && !test.value) {
                    path.replaceWith(path.node.body);
                }
            }
        });
    }

    /**
     * Step 4: 评估数值表达式
     * 计算 0.8289980428941415 * 0.4137228533846553 这样的表达式
     */
    private evaluateExpressions(): void {
        traverse(this.ast, {
            BinaryExpression: (path) => {
                const { left, right, operator } = path.node;
                
                // 尝试计算二元表达式
                if (
                    t.isNumericLiteral(left) &&
                    t.isNumericLiteral(right)
                ) {
                    let result: number;
                    
                    switch (operator) {
                        case '+':
                            result = left.value + right.value;
                            break;
                        case '-':
                            result = left.value - right.value;
                            break;
                        case '*':
                            result = left.value * right.value;
                            break;
                        case '/':
                            result = left.value / right.value;
                            break;
                        case '%':
                            result = left.value % right.value;
                            break;
                        case '**':
                            result = Math.pow(left.value, right.value);
                            break;
                        case '>>':
                            result = left.value >> right.value;
                            break;
                        case '<<':
                            result = left.value << right.value;
                            break;
                        case '>>>':
                            result = left.value >>> right.value;
                            break;
                        case '|':
                            result = left.value | right.value;
                            break;
                        case '&':
                            result = left.value & right.value;
                            break;
                        case '^':
                            result = left.value ^ right.value;
                            break;
                        default:
                            return;
                    }
                    
                    path.replaceWith(t.numericLiteral(result));
                }
                
                // 处理字符串拼接
                if (
                    operator === '+' &&
                    (t.isStringLiteral(left) || t.isStringLiteral(right))
                ) {
                    if (t.isStringLiteral(left) && t.isStringLiteral(right)) {
                        path.replaceWith(
                            t.stringLiteral(left.value + right.value)
                        );
                    }
                }
            },
            
            UnaryExpression: (path) => {
                const { argument, operator } = path.node;
                
                if (t.isNumericLiteral(argument)) {
                    let result: number;
                    
                    switch (operator) {
                        case '+':
                            result = +argument.value;
                            break;
                        case '-':
                            result = -argument.value;
                            break;
                        case '~':
                            result = ~argument.value;
                            break;
                        case '!':
                            path.replaceWith(
                                t.booleanLiteral(operator === '!' ? !argument.value : !!argument.value)
                            );
                            return;
                        default:
                            return;
                    }
                    
                    path.replaceWith(t.numericLiteral(result));
                }
            }
        });
    }

    /**
     * Step 5: 清理冗余代码
     */
    private cleanupRedundantCode(): void {
        traverse(this.ast, {
            // 移除空语句块
            BlockStatement: (path) => {
                path.node.body = path.node.body.filter(
                    (stmt) => !t.isEmptyStatement(stmt)
                );
            },
            
            // 移除只声明但未使用的变量
            VariableDeclarator: (path) => {
                const { id } = path.node;
                
                if (t.isIdentifier(id)) {
                    const binding = path.scope.getBinding(id.name);
                    
                    if (binding && binding.referencePaths.length === 0) {
                        path.remove();
                    }
                }
            }
        });
    }
}
