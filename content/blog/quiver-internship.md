+++
title = "Forecasting Sparse Demand at Quiver"
date = 2026-09-19

[taxonomies]
categories = ["Work", "Data Science"]
+++

From March to June 2026, I worked as a Data Science Intern at [Quiver](https://quiver.dk/), developing and evaluating demand-forecasting methods for inventory planning.

The internship gave me an opportunity to work on a deceptively difficult problem: forecasting monthly demand at the individual product level, where sales histories are often sparse, irregular, and punctuated by sudden spikes.

<!-- more -->

## Making experiments reproducible

A central part of my work was building a reproducible Python experimentation framework for comparing forecasting approaches with Quiver’s production ETS baseline.

Experiments were defined through configuration files and produced frozen configurations, predictions, and aggregate error metrics. This made it possible to benchmark models consistently across customers, validation folds, and data filters—and to return to an experiment later without having to reconstruct how it was run.

## Forecasting lumpy demand

Sparse demand creates some awkward failure modes. A model may predict zero for too long, react too strongly to a single spike, or extrapolate a short-lived trend far into the future.

I developed and tested gradient-boosting models using lagged values, rolling-window statistics, and seasonal features. I also explored DeepAR and product-hierarchy setups, alongside routing logic for sparse series and regression strategies based on product size.

The goal was not simply to build a more sophisticated model. It was to produce forecasts that behaved sensibly enough to support real inventory decisions.

## Evaluating more than one number

Aggregate error metrics are useful, but they can hide poor behaviour in individual product series. I therefore built tools for inspecting forecasts at a finer level, including dashboard-based series comparisons and blind tests of planner preferences.

This made it possible to examine forecast difficulty and certainty alongside metrics such as RMSE, mean absolute error, and bias. For most customer datasets, the proposed approaches improved aggregate MAE and bias while producing forecasts that were more operationally aligned than the baseline.

## Operational usefulness is the goal

A lower RMSE is not automatically a better forecast. A model can reduce its average error while systematically forecasting too low, leaving a customer exposed to stockouts. Even a model that is unbiased in aggregate can behave poorly where it matters: overforecasting some products, underforecasting others, or failing to reflect growth that planners have good reason to expect.

That does not make the metric useless. It means the metric is evidence rather than the objective. The real question is whether a forecast helps the customer make better inventory decisions while behaving in ways they can inspect, challenge, and trust.

## Complexity has a price

More complex models can capture patterns that simpler models miss, but their benefits come with operational costs. They are often harder to explain when a customer asks why a forecast changed, and they may require more customer-specific tuning, monitoring, and maintenance.

Reducing the number of questions or explanations a forecast generates can therefore be one sign that a model is working well—but it is not the only test. Complexity may still be worthwhile when it produces meaningfully better inventory decisions, handles important edge cases, or reduces costly forecast failures. The gain has to outweigh the full cost of deploying, maintaining, explaining, and adapting the model. If a more complicated approach improves a benchmark without improving that overall balance, the simpler model is probably more valuable.

## What I took away

The internship reinforced that a forecasting model is only useful when its behaviour can be understood, evaluated, and connected to a decision. Accuracy, bias, planner expectations, explainability, and maintenance cost all contribute to that usefulness.

Some of the most productive work came from simplifying the problem: identifying which product series required different treatment, diagnosing unstable behaviour, and translating experimental results into practical recommendations. I presented those findings to Quiver’s CEO and CTO, and they helped inform further trials of a simpler, customer-tuned model.

Coming from bioinformatics, I found the transition surprisingly natural. Both fields involve incomplete observations, noisy systems, careful validation, and the constant question of whether a detected pattern represents useful signal or merely a convincing accident.
