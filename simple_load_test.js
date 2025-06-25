const http = require('http');

class SimpleTemplateLoadTester {
    constructor(baseUrl = 'http://localhost:3000') {
        this.baseUrl = baseUrl;
        this.results = [];
        this.errors = [];
        this.startTime = null;
        this.endTime = null;
    }

    async makeRequest(id) {
        const startTime = Date.now();
        
        return new Promise((resolve, reject) => {
            const req = http.request({
                hostname: 'localhost',
                port: 3000,
                path: '/pdf?template=simple_template',
                method: 'GET',
                timeout: 35000
            }, (res) => {
                let dataLength = 0;
                
                res.on('data', (chunk) => {
                    dataLength += chunk.length;
                });
                
                res.on('end', () => {
                    const endTime = Date.now();
                    const duration = endTime - startTime;
                    resolve({
                        id,
                        duration,
                        success: res.statusCode === 200,
                        statusCode: res.statusCode,
                        pdfSize: dataLength,
                        startTime,
                        endTime
                    });
                });
            });

            req.on('error', (err) => {
                const endTime = Date.now();
                const duration = endTime - startTime;
                reject({
                    id,
                    duration,
                    success: false,
                    error: err.message || 'Connection error',
                    startTime,
                    endTime
                });
            });

            req.on('timeout', () => {
                req.destroy();
                const endTime = Date.now();
                const duration = endTime - startTime;
                reject({
                    id,
                    duration,
                    success: false,
                    error: 'Request timeout',
                    startTime,
                    endTime
                });
            });

            req.end();
        });
    }

    async runLoadTest(requestsPerSecond, durationSeconds) {
        console.log(`\n🚀 Simple Template Load Test`);
        console.log(`   Target: ${requestsPerSecond} req/sec for ${durationSeconds} seconds`);
        console.log(`   Total requests: ${requestsPerSecond * durationSeconds}`);
        console.log('='.repeat(60));
        
        const totalRequests = requestsPerSecond * durationSeconds;
        const intervalMs = 1000 / requestsPerSecond;
        const promises = [];
        
        this.startTime = Date.now();
        
        // Launch requests at specified rate
        for (let i = 1; i <= totalRequests; i++) {
            const delay = (i - 1) * intervalMs;
            const promise = new Promise(resolve => {
                setTimeout(async () => {
                    try {
                        const result = await this.makeRequest(i);
                        resolve(result);
                    } catch (error) {
                        resolve(error);
                    }
                }, delay);
            });
            promises.push(promise);
        }
        
        console.log(`Launching ${totalRequests} requests...`);
        const results = await Promise.all(promises);
        this.endTime = Date.now();
        
        // Analyze results
        const successful = results.filter(r => r.success);
        const failed = results.filter(r => !r.success);
        
        // Calculate statistics
        const durations = successful.map(r => r.duration);
        const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
        const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
        const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;
        const totalTime = this.endTime - this.startTime;
        const actualThroughput = successful.length / (totalTime / 1000);
        
        // Calculate percentiles
        const sortedDurations = durations.sort((a, b) => a - b);
        const p50 = sortedDurations.length > 0 ? sortedDurations[Math.floor(sortedDurations.length * 0.5)] : 0;
        const p95 = sortedDurations.length > 0 ? sortedDurations[Math.floor(sortedDurations.length * 0.95)] : 0;
        const p99 = sortedDurations.length > 0 ? sortedDurations[Math.floor(sortedDurations.length * 0.99)] : 0;
        
        // Calculate PDF sizes
        const pdfSizes = successful.map(r => r.pdfSize);
        const avgPdfSize = pdfSizes.length > 0 ? pdfSizes.reduce((a, b) => a + b, 0) / pdfSizes.length : 0;
        
        // Performance categorization
        const fast = successful.filter(r => r.duration < 100).length;
        const medium = successful.filter(r => r.duration >= 100 && r.duration < 1000).length;
        const slow = successful.filter(r => r.duration >= 1000).length;
        
        // Time-based analysis
        const requestTimes = successful.map(r => ({ time: r.startTime - this.startTime, duration: r.duration }));
        const firstHalf = requestTimes.filter(r => r.time < totalTime / 2);
        const secondHalf = requestTimes.filter(r => r.time >= totalTime / 2);
        
        const firstHalfAvg = firstHalf.length > 0 ? firstHalf.reduce((a, b) => a + b.duration, 0) / firstHalf.length : 0;
        const secondHalfAvg = secondHalf.length > 0 ? secondHalf.reduce((a, b) => a + b.duration, 0) / secondHalf.length : 0;
        
        console.log(`\n✅ Load Test Results:`);
        console.log(`   Success Rate: ${successful.length}/${totalRequests} (${((successful.length/totalRequests)*100).toFixed(1)}%)`);
        console.log(`   Target Throughput: ${requestsPerSecond} req/sec`);
        console.log(`   Actual Throughput: ${actualThroughput.toFixed(2)} req/sec`);
        console.log(`   Total Test Time: ${(totalTime/1000).toFixed(1)}s`);
        console.log(`\n📊 Response Times:`);
        console.log(`   Average: ${avgDuration.toFixed(0)}ms`);
        console.log(`   Min/Max: ${minDuration}ms - ${maxDuration}ms`);
        console.log(`   50th Percentile: ${p50}ms`);
        console.log(`   95th Percentile: ${p95}ms`);
        console.log(`   99th Percentile: ${p99}ms`);
        console.log(`\n📈 Performance Distribution:`);
        console.log(`   Fast (<100ms): ${fast} requests (${((fast/successful.length)*100).toFixed(1)}%)`);
        console.log(`   Medium (100-1000ms): ${medium} requests (${((medium/successful.length)*100).toFixed(1)}%)`);
        console.log(`   Slow (>1000ms): ${slow} requests (${((slow/successful.length)*100).toFixed(1)}%)`);
        console.log(`\n📄 PDF Generation:`);
        console.log(`   Average PDF Size: ${(avgPdfSize/1024).toFixed(1)}KB`);
        console.log(`   Total Data Generated: ${((avgPdfSize * successful.length)/1024/1024).toFixed(2)}MB`);
        
        if (firstHalf.length > 0 && secondHalf.length > 0) {
            console.log(`\n⏱️  Performance Over Time:`);
            console.log(`   First Half Average: ${firstHalfAvg.toFixed(0)}ms`);
            console.log(`   Second Half Average: ${secondHalfAvg.toFixed(0)}ms`);
            const improvement = firstHalfAvg - secondHalfAvg;
            if (improvement > 0) {
                console.log(`   Improvement: ${improvement.toFixed(0)}ms faster (${((improvement/firstHalfAvg)*100).toFixed(1)}% better)`);
            } else {
                console.log(`   Degradation: ${Math.abs(improvement).toFixed(0)}ms slower (${((Math.abs(improvement)/firstHalfAvg)*100).toFixed(1)}% worse)`);
            }
        }
        
        if (failed.length > 0) {
            console.log(`\n❌ Failed Requests: ${failed.length}`);
            const errorCounts = {};
            failed.forEach(f => {
                errorCounts[f.error] = (errorCounts[f.error] || 0) + 1;
            });
            Object.entries(errorCounts).forEach(([error, count]) => {
                console.log(`   ${error}: ${count} requests`);
            });
        }
        
        // Performance assessment
        console.log(`\n🎯 Performance Assessment:`);
        if (actualThroughput >= requestsPerSecond * 0.9) {
            console.log(`   ✅ Excellent: Achieved ${((actualThroughput/requestsPerSecond)*100).toFixed(1)}% of target throughput`);
        } else if (actualThroughput >= requestsPerSecond * 0.7) {
            console.log(`   ⚠️  Good: Achieved ${((actualThroughput/requestsPerSecond)*100).toFixed(1)}% of target throughput`);
        } else {
            console.log(`   ❌ Poor: Only achieved ${((actualThroughput/requestsPerSecond)*100).toFixed(1)}% of target throughput`);
        }
        
        if (p95 < 1000) {
            console.log(`   ✅ Response times acceptable (95th percentile: ${p95}ms)`);
        } else if (p95 < 3000) {
            console.log(`   ⚠️  Response times moderate (95th percentile: ${p95}ms)`);
        } else {
            console.log(`   ❌ Response times poor (95th percentile: ${p95}ms)`);
        }
        
        return {
            totalRequests,
            successful: successful.length,
            failed: failed.length,
            targetThroughput: requestsPerSecond,
            actualThroughput,
            avgDuration,
            p50,
            p95,
            p99,
            avgPdfSize,
            totalTime
        };
    }

    async runScalabilityTest() {
        console.log('🔥 Simple Template Scalability Test');
        console.log('Testing different load levels to find optimal throughput');
        console.log('='.repeat(70));
        
        const testScenarios = [
            { rps: 1, duration: 10, name: 'Baseline (1 req/sec)' },
            { rps: 2, duration: 10, name: 'Light Load (2 req/sec)' },
            { rps: 5, duration: 10, name: 'Medium Load (5 req/sec)' },
            { rps: 10, duration: 10, name: 'Heavy Load (10 req/sec)' },
            { rps: 15, duration: 10, name: 'High Load (15 req/sec)' },
            { rps: 20, duration: 10, name: 'Maximum Load (20 req/sec)' }
        ];
        
        const allResults = [];
        
        for (const scenario of testScenarios) {
            console.log(`\n🧪 Testing ${scenario.name}...`);
            const result = await this.runLoadTest(scenario.rps, scenario.duration);
            result.testName = scenario.name;
            result.targetRps = scenario.rps;
            allResults.push(result);
            
            // Wait between tests to let the service recover
            console.log('   Waiting 5 seconds before next test...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
        
        // Summary analysis
        console.log('\n📊 Scalability Summary');
        console.log('='.repeat(80));
        console.log('| Load Level      | Target | Actual | Success | Avg Time | 95th %ile | Assessment |');
        console.log('|-----------------|--------|--------|---------|----------|-----------|------------|');
        
        allResults.forEach(result => {
            const name = result.testName.split('(')[0].trim().padEnd(15);
            const target = `${result.targetRps} rps`.padEnd(6);
            const actual = `${result.actualThroughput.toFixed(1)} rps`.padEnd(6);
            const success = `${((result.successful/result.totalRequests)*100).toFixed(0)}%`.padEnd(7);
            const avgTime = `${result.avgDuration.toFixed(0)}ms`.padEnd(8);
            const p95 = `${result.p95}ms`.padEnd(9);
            
            let assessment = 'Poor';
            if (result.actualThroughput >= result.targetRps * 0.9 && result.p95 < 1000) {
                assessment = 'Excellent';
            } else if (result.actualThroughput >= result.targetRps * 0.7 && result.p95 < 3000) {
                assessment = 'Good';
            } else if (result.actualThroughput >= result.targetRps * 0.5) {
                assessment = 'Fair';
            }
            
            console.log(`| ${name} | ${target} | ${actual} | ${success} | ${avgTime} | ${p95} | ${assessment.padEnd(10)} |`);
        });
        
        // Find optimal throughput
        const excellentResults = allResults.filter(r => r.actualThroughput >= r.targetRps * 0.9 && r.p95 < 1000);
        const goodResults = allResults.filter(r => r.actualThroughput >= r.targetRps * 0.7 && r.p95 < 3000);
        
        console.log('\n🎯 Recommendations:');
        if (excellentResults.length > 0) {
            const best = excellentResults[excellentResults.length - 1];
            console.log(`   ✅ Recommended Production Load: ${best.targetRps} req/sec`);
            console.log(`      - Achieves ${best.actualThroughput.toFixed(1)} req/sec actual throughput`);
            console.log(`      - 95th percentile response time: ${best.p95}ms`);
            console.log(`      - Success rate: ${((best.successful/best.totalRequests)*100).toFixed(1)}%`);
        } else if (goodResults.length > 0) {
            const best = goodResults[goodResults.length - 1];
            console.log(`   ⚠️  Maximum Acceptable Load: ${best.targetRps} req/sec`);
            console.log(`      - Achieves ${best.actualThroughput.toFixed(1)} req/sec actual throughput`);
            console.log(`      - 95th percentile response time: ${best.p95}ms`);
            console.log(`      - Monitor closely in production`);
        } else {
            console.log(`   ❌ Service struggles with load - consider optimization`);
            console.log(`      - Even 1 req/sec shows performance issues`);
            console.log(`      - Review process pooling and WeasyPrint configuration`);
        }
        
        return allResults;
    }
}

// Run the test
async function main() {
    const tester = new SimpleTemplateLoadTester();
    
    try {
        // You can run either a single load test or full scalability test
        const args = process.argv.slice(2);
        
        if (args.length >= 2) {
            // Single test: node simple_load_test.js <rps> <duration>
            const rps = parseInt(args[0]);
            const duration = parseInt(args[1]);
            
            if (rps > 0 && rps <= 20 && duration > 0) {
                await tester.runLoadTest(rps, duration);
            } else {
                console.error('Usage: node simple_load_test.js <rps> <duration>');
                console.error('  rps: 1-20 requests per second');
                console.error('  duration: test duration in seconds');
                process.exit(1);
            }
        } else {
            // Full scalability test
            await tester.runScalabilityTest();
        }
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = SimpleTemplateLoadTester; 