const http = require('http');

class LoadTester {
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
                path: `/pdf?html=${encodeURIComponent(`<h1>Load Test ${id}</h1><p>Request ${id} at ${new Date().toISOString()}</p>`)}`,
                method: 'GET',
                timeout: 35000
            }, (res) => {
                let data = Buffer.alloc(0);
                
                res.on('data', (chunk) => {
                    data = Buffer.concat([data, chunk]);
                });
                
                res.on('end', () => {
                    const endTime = Date.now();
                    const duration = endTime - startTime;
                    resolve({
                        id,
                        duration,
                        statusCode: res.statusCode,
                        size: data.length,
                        success: res.statusCode === 200 && data.length > 1000
                    });
                });
            });
            
            req.on('error', (err) => {
                const endTime = Date.now();
                reject({
                    id,
                    error: err.message,
                    duration: endTime - startTime
                });
            });
            
            req.on('timeout', () => {
                req.destroy();
                const endTime = Date.now();
                reject({
                    id,
                    error: 'Request timeout',
                    duration: endTime - startTime
                });
            });
            
            req.end();
        });
    }

    async runLoadTest(requestsPerSecond, durationSeconds) {
        console.log(`\n🚀 Starting load test:`);
        console.log(`   Target: ${requestsPerSecond} req/sec for ${durationSeconds} seconds`);
        console.log(`   Total requests: ${requestsPerSecond * durationSeconds}`);
        console.log(`   Interval: ${1000 / requestsPerSecond}ms between requests\n`);

        this.results = [];
        this.errors = [];
        this.startTime = Date.now();

        const interval = 1000 / requestsPerSecond;
        const totalRequests = requestsPerSecond * durationSeconds;
        let requestId = 1;
        let activeRequests = 0;
        let completedRequests = 0;

        return new Promise((resolve) => {
            const timer = setInterval(async () => {
                if (requestId > totalRequests) {
                    clearInterval(timer);
                    
                    // Wait for all active requests to complete
                    const checkCompletion = setInterval(() => {
                        if (activeRequests === 0) {
                            clearInterval(checkCompletion);
                            this.endTime = Date.now();
                            resolve(this.analyzeResults());
                        }
                    }, 100);
                    return;
                }

                activeRequests++;
                const currentId = requestId++;

                this.makeRequest(currentId)
                    .then(result => {
                        this.results.push(result);
                        activeRequests--;
                        completedRequests++;
                        
                        if (completedRequests % 10 === 0) {
                            console.log(`✓ Completed ${completedRequests}/${totalRequests} requests (Active: ${activeRequests})`);
                        }
                    })
                    .catch(error => {
                        this.errors.push(error);
                        activeRequests--;
                        completedRequests++;
                        console.log(`✗ Request ${currentId} failed: ${error.error}`);
                    });

            }, interval);
        });
    }

    analyzeResults() {
        const totalDuration = this.endTime - this.startTime;
        const successful = this.results.filter(r => r.success);
        const failed = this.results.filter(r => !r.success).concat(this.errors);
        
        const durations = successful.map(r => r.duration);
        const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length || 0;
        const minDuration = Math.min(...durations) || 0;
        const maxDuration = Math.max(...durations) || 0;
        
        // Calculate percentiles
        const sortedDurations = durations.sort((a, b) => a - b);
        const p50 = sortedDurations[Math.floor(sortedDurations.length * 0.5)] || 0;
        const p95 = sortedDurations[Math.floor(sortedDurations.length * 0.95)] || 0;
        const p99 = sortedDurations[Math.floor(sortedDurations.length * 0.99)] || 0;

        const actualRps = (successful.length / (totalDuration / 1000)).toFixed(2);
        const successRate = ((successful.length / (this.results.length + this.errors.length)) * 100).toFixed(1);

        return {
            totalRequests: this.results.length + this.errors.length,
            successful: successful.length,
            failed: failed.length,
            successRate: parseFloat(successRate),
            actualRps: parseFloat(actualRps),
            avgDuration,
            minDuration,
            maxDuration,
            p50,
            p95,
            p99,
            totalDuration,
            errors: this.errors
        };
    }

    printResults(results) {
        console.log(`\n📊 LOAD TEST RESULTS:`);
        console.log(`════════════════════════════════════════`);
        console.log(`Total Requests:     ${results.totalRequests}`);
        console.log(`Successful:         ${results.successful} ✓`);
        console.log(`Failed:            ${results.failed} ✗`);
        console.log(`Success Rate:      ${results.successRate}%`);
        console.log(`Actual RPS:        ${results.actualRps} req/sec`);
        console.log(`Test Duration:     ${(results.totalDuration / 1000).toFixed(1)}s`);
        console.log(`\n⏱️  RESPONSE TIMES:`);
        console.log(`Average:           ${results.avgDuration.toFixed(0)}ms`);
        console.log(`Minimum:           ${results.minDuration}ms`);
        console.log(`Maximum:           ${results.maxDuration}ms`);
        console.log(`50th percentile:   ${results.p50}ms`);
        console.log(`95th percentile:   ${results.p95}ms`);
        console.log(`99th percentile:   ${results.p99}ms`);

        // Performance evaluation
        console.log(`\n🎯 PERFORMANCE EVALUATION:`);
        
        if (results.successRate >= 99) {
            console.log(`✅ Reliability: EXCELLENT (${results.successRate}% success rate)`);
        } else if (results.successRate >= 95) {
            console.log(`✅ Reliability: GOOD (${results.successRate}% success rate)`);
        } else {
            console.log(`❌ Reliability: POOR (${results.successRate}% success rate)`);
        }

        if (results.p95 <= 200) {
            console.log(`✅ Latency: EXCELLENT (95th percentile: ${results.p95}ms)`);
        } else if (results.p95 <= 500) {
            console.log(`✅ Latency: GOOD (95th percentile: ${results.p95}ms)`);
        } else if (results.p95 <= 1000) {
            console.log(`⚠️  Latency: ACCEPTABLE (95th percentile: ${results.p95}ms)`);
        } else {
            console.log(`❌ Latency: POOR (95th percentile: ${results.p95}ms)`);
        }

        if (results.actualRps >= 15) {
            console.log(`✅ Throughput: EXCELLENT (${results.actualRps} req/sec)`);
        } else if (results.actualRps >= 10) {
            console.log(`✅ Throughput: GOOD (${results.actualRps} req/sec)`);
        } else {
            console.log(`❌ Throughput: INSUFFICIENT (${results.actualRps} req/sec)`);
        }

        // Recommendations
        console.log(`\n💡 RECOMMENDATIONS:`);
        if (results.successRate < 99) {
            console.log(`• Investigate failed requests and improve error handling`);
        }
        if (results.p95 > 500) {
            console.log(`• Consider increasing worker pool size`);
            console.log(`• Optimize WeasyPrint process initialization`);
        }
        if (results.actualRps < 15) {
            console.log(`• Scale up worker pool or container resources`);
            console.log(`• Consider horizontal scaling for higher loads`);
        }
        if (results.p95 <= 200 && results.successRate >= 99 && results.actualRps >= 15) {
            console.log(`🎉 Current setup is PRODUCTION READY for 10-20 req/sec!`);
        }

        if (results.errors.length > 0) {
            console.log(`\n❌ ERROR DETAILS:`);
            results.errors.forEach(error => {
                console.log(`   Request ${error.id}: ${error.error} (${error.duration}ms)`);
            });
        }
    }
}

async function main() {
    const tester = new LoadTester();
    
    console.log('🔍 Testing service availability...');
    try {
        await tester.makeRequest(0);
        console.log('✅ Service is available\n');
    } catch (error) {
        console.log('❌ Service is not available:', error);
        process.exit(1);
    }

    // Test scenarios
    const scenarios = [
        { rps: 5, duration: 10, name: "Warm-up (5 req/sec for 10s)" },
        { rps: 10, duration: 20, name: "Target Load (10 req/sec for 20s)" },
        { rps: 15, duration: 15, name: "High Load (15 req/sec for 15s)" },
        { rps: 20, duration: 10, name: "Peak Load (20 req/sec for 10s)" }
    ];

    for (const scenario of scenarios) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🧪 ${scenario.name}`);
        console.log(`${'='.repeat(60)}`);
        
        const results = await tester.runLoadTest(scenario.rps, scenario.duration);
        tester.printResults(results);
        
        // Cool down between tests
        if (scenario !== scenarios[scenarios.length - 1]) {
            console.log('\n⏳ Cooling down for 5 seconds...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🏁 LOAD TESTING COMPLETE`);
    console.log(`${'='.repeat(60)}`);
}

main().catch(console.error); 