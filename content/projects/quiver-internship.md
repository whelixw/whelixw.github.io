+++
title = "Forecasting Sparse Demand at Quiver"
date = 2026-09-19
aliases = ["/blog/quiver-internship/"]
template = "post.html"

[taxonomies]
categories = ["Work", "Data Science"]
+++

From March to June 2026, I worked as a Data Science Intern at [Quiver](https://quiver.dk/), developing and evaluating demand-forecasting methods for inventory planning.

The internship gave me an opportunity to work on a deceptively difficult problem: forecasting monthly demand at the individual product level, where sales histories are often sparse, irregular, and punctuated by sudden spikes.

<!-- more -->

![Blind comparison between two synthetic forecasts before actual demand is revealed](/img/quiver-blind-forecast-before.png)

*Two forecasts for a synthetic product series. Which one would you choose?*

## Forecasting lumpy demand

Sparse demand creates some awkward failure modes. A model may predict zero for too long, react too strongly to a single spike, or extrapolate a short-lived trend far into the future.

I developed and tested gradient-boosting models using lagged values, rolling-window statistics, and seasonal features. I also explored DeepAR and product-hierarchy setups, alongside routing logic for sparse series and regression strategies based on product size.

Average demand interval (ADI), measured here in months between non-zero observations, and demand variation provided a useful map of the problem. They helped distinguish smooth and erratic demand from intermittent and lumpy series, where the same forecasting policy often behaved very differently.

![Synthetic demand-pattern scatter showing smooth, erratic, intermittent, and lumpy product series](/img/quiver-demand-patterns.png)

*An anonymized illustration of the demand-pattern map. Every point represents a synthetic product series.*

The goal was not simply to build a more sophisticated model. It was to produce forecasts that behaved sensibly enough to support real inventory decisions.

## Making experiments reproducible

A central part of my work was building a reproducible Python experimentation framework for comparing forecasting approaches with Quiver’s production ETS baseline.

Experiments were defined through configuration files and produced frozen configurations, predictions, and aggregate error metrics. This made it possible to benchmark models consistently across customers, validation folds, and data filters, and to return to an experiment later without having to reconstruct how it was run.

## Evaluating more than one number

Aggregate error metrics are useful, but they can hide poor behaviour in individual product series. I built an interactive series inspector that connected each point in the demand-pattern scatter to its underlying history and forecasts, making it easier to investigate where models disagreed.

I also designed a dashboard for internal blind comparisons, following the before-and-after format illustrated in this post. Before revealing actual demand, the aim was to explore what made one forecast look more reasonable than another. After revealing actual demand, the question became how people judged forecast quality and how often those judgments agreed with RMSE, MAE, and bias. This helped us explore the relationship between a forecast looking sensible, matching observed demand, and scoring well on a particular metric.

Once a candidate model passed the quantitative evaluation, we also loaded its forecasts into the planning frontend alongside the current production forecast. We often inspected some of the top products to assess which forecast seemed more reasonable in context, including whether it reacted excessively to isolated spikes or extended a short-lived trend too far.

Together, these methods complemented the numerical benchmarks with closer scrutiny of forecast behaviour and human judgment.

![Blind comparison after revealing the synthetic actual demand](/img/quiver-blind-forecast-after.png)

*The actual demand is shown in black. Does seeing it change which forecast you prefer? No customer or product data are included.*

## Operational usefulness is the goal

The comparisons raised three distinct questions: does a forecast look reasonable, does it score well against observed demand, and does it help someone make a better inventory decision? Agreement on the first two does not establish the third.

A model can reduce average error while systematically forecasting too low, potentially leaving a customer exposed to stockouts. Even a model that is unbiased in aggregate can overforecast some products and underforecast others. The consequences depend on the products, the planning decisions, and the costs of getting those decisions wrong.

Our evaluations helped assess whether a candidate deserved further trials. Establishing that it improved inventory outcomes would require evaluating the decisions made using those forecasts and their consequences.

## Complexity has a price

More complex models can capture patterns that simpler models miss, but their benefits come with operational costs. They are often harder to explain when a customer asks why a forecast changed, and they may require more customer-specific tuning, monitoring, and maintenance.

A model therefore needs to earn its complexity. Better handling of important demand patterns may justify the extra work, but a small benchmark improvement may not. The practical comparison includes the effort needed to deploy, explain, monitor, and adapt each approach.

## What I took away

Some of the most productive work came from simplifying the problem: identifying which product series required different treatment, diagnosing unstable behaviour, and translating experimental results into practical recommendations. I presented those findings to Quiver’s CEO and CTO, and they helped inform further trials of a simpler, customer-tuned model.

Coming from bioinformatics, I found the transition surprisingly natural. Both fields involve incomplete observations, noisy systems, careful validation, and the constant question of whether a detected pattern represents useful signal or merely a convincing accident.
