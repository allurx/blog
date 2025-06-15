---
title: FilterChainProxy源码分析
date: 2019-07-01
categories:
- Spring
- Spring-Security
- Spring-Security过滤流程
tags:
- Spring
- Spring-Security
- Spring-Security过滤流程
---

# 概述

从spring-security的**基本概念**到**核心过滤器**的源码分析再到**自动配置**的原理，我们已经知道了spring-security是如何为我们创建默认的配置，创建默认的过滤器链以及这些过滤器执行的原理，现在还差的一点是这些过滤器是如何执行的，现在我们已经知道最终的生成的过滤器是FilterChainProxy的一个实例，最终就是它来对所有请求进行过滤的。

<!-- more -->

# FilterChainProxy

```java
public class FilterChainProxy extends GenericFilterBean {

	private static final Log logger = LogFactory.getLog(FilterChainProxy.class);
	// 过滤器是否执行过的标记
	private final static String FILTER_APPLIED = FilterChainProxy.class.getName().concat(
			".APPLIED");
    // 一系列的过滤链
	private List<SecurityFilterChain> filterChains;
    // 过滤链验证器，默认为空
	private FilterChainValidator filterChainValidator = new NullFilterChainValidator();
    // http防火墙，主要的作用是拒绝一些潜在的危险的请求
	private HttpFirewall firewall = new StrictHttpFirewall();

	public FilterChainProxy() {
	}

	public FilterChainProxy(SecurityFilterChain chain) {
		this(Arrays.asList(chain));
	}

	public FilterChainProxy(List<SecurityFilterChain> filterChains) {
		this.filterChains = filterChains;
	}

	@Override
	public void afterPropertiesSet() {
		filterChainValidator.validate(this);
	}
    // 过滤逻辑
	@Override
	public void doFilter(ServletRequest request, ServletResponse response,
			FilterChain chain) throws IOException, ServletException {
        // 是否清空上下文（是否执行过该过滤器）
		boolean clearContext = request.getAttribute(FILTER_APPLIED) == null;
        // 没有执行过该过滤器
		if (clearContext) {
			try {
                // 设置执行过的标记
				request.setAttribute(FILTER_APPLIED, Boolean.TRUE);
                // 执行过滤逻辑
				doFilterInternal(request, response, chain);
			}
			finally {
                // 清空安全上下文
				SecurityContextHolder.clearContext();
                // 移除执行过的标记
				request.removeAttribute(FILTER_APPLIED);
			}
		}
		else {
            // 执行过滤逻辑
			doFilterInternal(request, response, chain);
		}
	}

	private void doFilterInternal(ServletRequest request, ServletResponse response,
			FilterChain chain) throws IOException, ServletException {
		// 校验请求然后封装成一个FirewalledRequest
		FirewalledRequest fwRequest = firewall
				.getFirewalledRequest((HttpServletRequest) request);
        // 校验响应然后封装成一个HttpServletResponse
		HttpServletResponse fwResponse = firewall
				.getFirewalledResponse((HttpServletResponse) response);
		// 根据请求找到匹配的过滤器，注意只返回第一个匹配请求的过滤器链
		List<Filter> filters = getFilters(fwRequest);

		if (filters == null || filters.size() == 0) {
			if (logger.isDebugEnabled()) {
				logger.debug(UrlUtils.buildRequestUrl(fwRequest)
						+ (filters == null ? " has no matching filters"
								: " has an empty filter list"));
			}

			fwRequest.reset();

			chain.doFilter(fwRequest, fwResponse);

			return;
		}
		// 将FirewalledRequest，FilterChain和filters包装成一个VirtualFilterChain
		VirtualFilterChain vfc = new VirtualFilterChain(fwRequest, chain, filters);
        // 开始执行过滤逻辑
		vfc.doFilter(fwRequest, fwResponse);
	}

	// 只返回第一个匹配请求的过滤器链
	private List<Filter> getFilters(HttpServletRequest request) {
		for (SecurityFilterChain chain : filterChains) {
			if (chain.matches(request)) {
				return chain.getFilters();
			}
		}

		return null;
	}

	public List<Filter> getFilters(String url) {
		return getFilters(firewall.getFirewalledRequest((new FilterInvocation(url, "GET")
				.getRequest())));
	}

	public List<SecurityFilterChain> getFilterChains() {
		return Collections.unmodifiableList(filterChains);
	}

	public void setFilterChainValidator(FilterChainValidator filterChainValidator) {
		this.filterChainValidator = filterChainValidator;
	}

	public void setFirewall(HttpFirewall firewall) {
		this.firewall = firewall;
	}

	@Override
	public String toString() {
		StringBuilder sb = new StringBuilder();
		sb.append("FilterChainProxy[");
		sb.append("Filter Chains: ");
		sb.append(filterChains);
		sb.append("]");

		return sb.toString();
	}

	// 将匹配的请求的过滤链中所有过滤器对请求进行过滤
	private static class VirtualFilterChain implements FilterChain {
        // 原始过滤链
		private final FilterChain originalChain;
        // 配置的所有过滤器
		private final List<Filter> additionalFilters;
        // 请求
		private final FirewalledRequest firewalledRequest;
        // 过滤器链的长度
		private final int size;
        // 当前执行的位置（第几个过滤器在执行）
		private int currentPosition = 0;

		private VirtualFilterChain(FirewalledRequest firewalledRequest,
				FilterChain chain, List<Filter> additionalFilters) {
			this.originalChain = chain;
			this.additionalFilters = additionalFilters;
			this.size = additionalFilters.size();
			this.firewalledRequest = firewalledRequest;
		}
		// 核心过滤逻辑
		@Override
		public void doFilter(ServletRequest request, ServletResponse response)
				throws IOException, ServletException {
            // 如果已经过滤到尾部过滤器，原始过滤链开始过滤
			if (currentPosition == size) {
				if (logger.isDebugEnabled()) {
					logger.debug(UrlUtils.buildRequestUrl(firewalledRequest)
							+ " reached end of additional filter chain; proceeding with original chain");
				}

				// Deactivate path stripping as we exit the security filter chain
				this.firewalledRequest.reset();

				originalChain.doFilter(request, response);
			}
			else {
                // 当前过滤的位置加一
				currentPosition++;
				// 获取当前位置的过滤器
				Filter nextFilter = additionalFilters.get(currentPosition - 1);

				if (logger.isDebugEnabled()) {
					logger.debug(UrlUtils.buildRequestUrl(firewalledRequest)
							+ " at position " + currentPosition + " of " + size
							+ " in additional filter chain; firing Filter: '"
							+ nextFilter.getClass().getSimpleName() + "'");
				}
				// 过滤器开始过滤
				nextFilter.doFilter(request, response, this);
			}
		}
	}

	public interface FilterChainValidator {
		void validate(FilterChainProxy filterChainProxy);
	}

	private static class NullFilterChainValidator implements FilterChainValidator {
		@Override
		public void validate(FilterChainProxy filterChainProxy) {
		}
	}

}
```

# 总结

1. 对请求和响应进行安全检查，并返回对应的包装类
2. 根据请求找到**第一个匹配的SecurityFilterChain**，然后返回SecurityFilterChain包含的所有过滤器
3. 将请求，原始过滤链以及上一步返回的过滤器包装成一个VirtualFilterChain，挨个执行这些过滤器

