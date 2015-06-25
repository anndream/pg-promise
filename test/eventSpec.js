var pgClient = require('pg/lib/client');
var header = require('./db/header');

var promise = header.promise;
var options = {
    promiseLib: promise // use Bluebird for testing;
};
var dbHeader = header(options);
var pgp = dbHeader.pgp;
var db = dbHeader.db;

// empty function;
var nope = function () {
};

describe("Connect/Disconnect events", function () {

    describe("during a query", function () {
        var p1, p2, connect = 0, disconnect = 0;
        beforeEach(function (done) {
            options.connect = function (client) {
                p1 = client;
                connect++;
                throw new Error("### Testing error output in 'connect'. Please ignore. ###");
            };
            options.disconnect = function (client) {
                p2 = client;
                disconnect++;
                throw new Error("### Testing error output in 'disconnect'. Please ignore. ###");
            };
            db.query("select 'test'")
                .then(nope, nope)
                .finally(function () {
                    done();
                });
        });
        afterEach(function () {
            options.connect = null;
            options.disconnect = null;
        });
        it("must be sent correctly", function () {
            expect(connect).toBe(1);
            expect(disconnect).toBe(1);
            expect(p1 instanceof pgClient).toBe(true);
            expect(p2 instanceof pgClient).toBe(true);
        });
    });

    describe("during a transaction", function () {
        var p1, p2, connect = 0, disconnect = 0;
        beforeEach(function (done) {
            options.connect = function (client) {
                p1 = client;
                connect++;
            };
            options.disconnect = function (client) {
                p2 = client;
                disconnect++;
            };
            db.tx(function (t) {
                return promise.all([
                    t.query("select 'one'"),
                    t.query("select 'two'"),
                    t.query("select 'three'")
                ]);
            })
                .then(nope, nope)
                .finally(function () {
                    done();
                });
        });
        afterEach(function () {
            options.connect = null;
            options.disconnect = null;
        });
        it("must be sent correctly", function () {
            expect(connect).toBe(1);
            expect(disconnect).toBe(1);
            expect(p1 instanceof pgClient).toBe(true);
            expect(p2 instanceof pgClient).toBe(true);
        });
    });
});

describe("Query event", function () {

    describe("with valid handler", function () {
        var param, counter = 0;
        beforeEach(function (done) {
            options.query = function (e) {
                counter++;
                param = e;
                throw new Error("### Testing error output in 'query'. Please ignore. ###");
            };
            db.query("select $1", [123])
                .then(nope, nope)
                .finally(function () {
                    done();
                });
        });
        afterEach(function () {
            options.query = null;
        });
        it("must pass query and parameters correctly", function () {
            expect(counter).toBe(1);
            expect(param.query).toBe('select 123');
        });
    });

    describe("with invalid handler", function () {
        var error;
        beforeEach(function (done) {
            options.query = 123;
            db.query("select $1", [123])
                .then(function () {

                }, function (reason) {
                    error = reason;
                }).finally(function () {
                    done();
                });
        });
        afterEach(function () {
            options.query = null;
        });
        it("must reject with correct error", function () {
            expect(error instanceof Error).toBe(true);
            expect(error.message).toBe("Type 'function' was expected for property 'options.query'");
        });
    });

});

describe("Start/Finish transaction events", function () {
    var result, tag, ctx, start = 0, finish = 0;
    beforeEach(function (done) {
        options.transact = function (e) {
            if (e.ctx.finish) {
                finish++;
                ctx = e.ctx;
            } else {
                start++;
                tag = e.ctx.tag;
            }
            throw "### Testing error output in 'transact'. Please ignore. ###";
        };
        db.tx("myTransaction", function () {
            return promise.resolve('SUCCESS');
        })
            .then(function (data) {
                result = data;
            })
            .finally(function () {
                done();
            });
    });
    afterEach(function () {
        options.transact = null;
    });

    it("must execute correctly", function () {
        expect(result).toBe('SUCCESS');
        expect(start).toBe(1);
        expect(finish).toBe(1);
        expect(tag).toBe("myTransaction");
        expect(ctx.success).toBe(true);
    });
});

describe("Error event", function () {

    describe("from transaction callbacks", function () {
        var r, error, ctx, counter = 0;
        beforeEach(function (done) {
            options.error = function (err, e) {
                counter++;
                error = err;
                ctx = e.ctx;
                throw new Error("### Testing error output in 'error'. Please ignore. ###");
            };
            db.tx("Error Transaction", function () {
                throw new Error("Test Error");
            })
                .then(nope, function (reason) {
                    r = reason;
                })
                .finally(function () {
                    done();
                });
        });
        afterEach(function () {
            options.error = null;
        });
        it("must report errors", function () {
            expect(r instanceof Error).toBe(true);
            expect(r.message).toBe('Test Error');
            expect(error instanceof Error).toBe(true);
            expect(error.message).toBe('Test Error');
            expect(counter).toBe(1);
            expect(ctx.tag).toBe("Error Transaction");
        });
    });

    describe("for null-queries", function () {
        var txt, ctx, counter = 0;
        beforeEach(function (done) {
            options.error = function (err, e) {
                counter++;
                txt = err;
                ctx = e;
            };
            db.query(null)
                .then(nope, nope)
                .finally(function () {
                    done();
                });
        });
        afterEach(function () {
            options.error = null;
        });
        it("must fail correctly", function () {
            var msg = "Parameter 'query' must be a non-empty text string.";
            expect(txt).toBe(msg);
            expect(ctx.params).toBeUndefined();
            expect(counter).toBe(1);
        });
    });

    describe("for incorrect QRM", function () {
        var txt, ctx, counter = 0;
        beforeEach(function (done) {
            options.error = function (err, e) {
                counter++;
                txt = err;
                ctx = e;
            };
            db.query("Bla-Bla", undefined, 42)
                .then(nope, nope)
                .finally(function () {
                    done();
                });
        });
        afterEach(function () {
            options.error = null;
        });
        it("must reject with correct error", function () {
            var msg = "Invalid Query Result Mask specified.";
            expect(txt).toBe(msg);
            expect(ctx.query).toBe("Bla-Bla");
            expect(ctx.params).toBeUndefined();
            expect(counter).toBe(1);
        });
    });

    describe("for single-row requests", function () {
        var errTxt, context, counter = 0;
        beforeEach(function (done) {
            options.error = function (err, e) {
                counter++;
                errTxt = err;
                context = e;
            };
            db.one("select * from users")
                .then(nope, nope)
                .finally(function () {
                    done();
                });
        });
        afterEach(function () {
            options.error = null;
        });
        it("must reject with correct error", function () {
            expect(errTxt).toBe("Single row was expected from the query.");
            expect(context.query).toBe("select * from users");
            expect(context.params).toBeUndefined();
            expect(counter).toBe(1);
        });
    });

    describe("for no-row requests", function () {
        var errTxt, context, counter = 0;
        beforeEach(function (done) {
            options.error = function (err, e) {
                counter++;
                errTxt = err;
                context = e;
            };
            db.none("select * from users")
                .then(nope, nope)
                .finally(function () {
                    done();
                });
        });
        afterEach(function () {
            options.error = null;
        });
        it("must reject with correct error", function () {
            expect(errTxt).toBe("No return data was expected from the query.");
            expect(context.query).toBe("select * from users");
            expect(context.params).toBeUndefined();
            expect(counter).toBe(1);
        });
    });

    describe("for empty requests", function () {
        var errTxt, context, counter = 0;
        beforeEach(function (done) {
            options.error = function (err, e) {
                counter++;
                errTxt = err;
                context = e;
            };
            db.many("select * from users where id > $1", 1000)
                .then(nope, nope)
                .finally(function () {
                    done();
                });
        });
        afterEach(function () {
            options.error = null;
        });
        it("must reject with correct error", function () {
            expect(errTxt).toBe("No data returned from the query.");
            expect(context.query).toBe("select * from users where id > 1000");
            expect(context.params).toBeUndefined();
            expect(counter).toBe(1);
        });
    });

    describe("for invalid parameters", function () {
        var error, context, counter = 0, params = {};
        beforeEach(function (done) {
            options.error = function (err, e) {
                counter++;
                error = err;
                context = e;
            };
            db.query("${test}", params)
                .then(nope, nope)
                .finally(function () {
                    done();
                });
        });
        afterEach(function () {
            options.error = null;
        });
        it("must report the parameters correctly", function () {
            expect(error instanceof Error).toBe(true);
            expect(error.message).toBe("Property 'test' doesn't exist.");
            expect(context.query).toBe("${test}");
            expect(context.params).toBe(params);
            expect(counter).toBe(1);
        });
    });

});

describe("pgFormatting", function () {
    var result;
    beforeEach(function () {
        result = undefined;
        options.pgFormatting = true;
    });
    afterEach(function () {
        options.pgFormatting = false;
    });
    describe("query event", function () {
        var ctx = [];
        beforeEach(function (done) {
            options.query = function (e) {
                ctx.push(e);
            };
            promise.all([
                db.func("findUser", 1),
                db.one("select * from users where id=$1", [1])
            ])
                .then(function (data) {
                    result = data;
                })
                .finally(function () {
                    done();
                });
        });
        afterEach(function () {
            options.query = false;
        });
        it("must affect formatting accordingly", function () {
            expect(Array.isArray(result)).toBe(true);
            expect(ctx.length).toBe(2);
            // params will be passed back only because the formatting
            // is done by PG, and not by pg-promise:
            // BUG in PG: It changes the parameters passed!
            expect(ctx[0].params === 1 && ctx[1].params[0] === '1').toBe(true);
        });
    });
    describe("query as object", function () {
        var err;
        beforeEach(function (done) {
            db.query()// here, try e,pty, null, etc...
                .then(function (data) {
                    result = data;
                }, function (reason) {
                    err = reason;
                })
                .finally(function () {
                    done();
                });
        });
        it("must provide the original pg response", function () {
            //console.log("DATA:", result);
            //console.log("REASON:", err);
        })
    });
});

if (jasmine.Runner) {
    var _finishCallback = jasmine.Runner.prototype.finishCallback;
    jasmine.Runner.prototype.finishCallback = function () {
        // Run the old finishCallback:
        _finishCallback.bind(this)();

        pgp.end(); // closing pg database application pool;
    };
}
